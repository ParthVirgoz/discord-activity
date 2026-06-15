import type { Room } from "@colyseus/sdk";
import { Callbacks } from "@colyseus/sdk";
import type { WatchRoomState, QueueItem, Member, QueueItemStatus } from "../schema.js";
import { createYouTubePlayer, type VideoPlayer, type YtPlayerState } from "../youtube/YouTubePlayer.js";
import { parseYouTubeId, parsePlaylistId, isYouTubeLinkInput, fetchVideoTitle, parseDurationToSeconds, formatDurationSeconds, getYouTubeThumbnail } from "../utils/youtube.js";
import { isRawIpHost } from "../utils/youtubeEmbed.js";
import {
  searchYouTube,
  importYouTubePlaylist,
  fetchVideoDurationSec,
  type YouTubeVideoResult,
} from "../utils/api.js";
import { iconHtml } from "../utils/icons.js";
import { toast, type ToastType } from "../utils/toast.js";
import { isDiscordActivity } from "../utils/discordUrls.js";
import { configureRoomResilience, startRoomKeepAlive, safeRoomSend, bindNetworkRecoveryHandlers } from "../utils/roomConnection.js";
import { discordSDK } from "../utils/DiscordSDK.js";
import { waitForWatchState } from "../utils/roomState.js";
import { joinWatchRoom, persistWatchRoomId } from "../utils/watchRoomJoin.js";
import { takeBufferedSessionSync } from "../utils/watchRoomMessageBuffer.js";
import { detectWatchLayoutMode, type WatchLayoutMode } from "../utils/layoutMode.js";

const DRIFT_CHECK_INTERVAL_MS = 800;
const END_CHECK_INTERVAL_MS = 2000;
const SYNC_APPLY_THRESHOLD = 0.35;
/** Ignore echoed play/pause/seek from the room after local controller actions. */
const LOCAL_SYNC_GRACE_MS = 1500;
/** Suppress player state echo after programmatic play/pause/seek. */
const STATE_BROADCAST_SUPPRESS_MS = 600;
/** Piped stream lookup + proxy can take a long time in Discord — wait before skipping. */
const UNAVAILABLE_CHECK_MS = isDiscordActivity() ? 60_000 : 12_000;
/** Ignore schema drift correction briefly after a play/pause/seek message. */
const PLAYBACK_MESSAGE_GRACE_MS = 2500;
/** Shorter post-sync grace for host so manual controls reach the server quickly. */
const HOST_SYNC_GRACE_MS = 500;
const VIEWER_SYNC_GRACE_MS = 1500;
const BOOTSTRAP_HOST_GRACE_MS = 1200;
const BOOTSTRAP_VIEWER_GRACE_MS = 2000;
const MAX_VIDEO_LOAD_RETRIES = 2;

export interface QueueSnapshotItem {
  videoId: string;
  title: string;
  channelName: string;
  addedBy: string;
  addedBySessionId: string;
  status: QueueItemStatus;
  durationSec: number;
}

export interface SyncPayload {
  videoId: string;
  videoTitle: string;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  hostSessionId: string;
  videoDurationSec: number;
  allowEveryoneQueue: boolean;
  allowEveryonePlayback: boolean;
  allowOthersToHost: boolean;
  allowReplayPlayed?: boolean;
  dimPlayedInPlaylist?: boolean;
  continueFromPosition?: boolean;
  /** Authoritative playlist snapshot from server (join / reconnect / sync). */
  queue?: QueueSnapshotItem[];
}

export interface PermissionsPayload {
  allowEveryoneQueue: boolean;
  allowEveryonePlayback: boolean;
  allowOthersToHost: boolean;
  continueFromPosition?: boolean;
}

export class WatchApp {
  private room: Room<WatchRoomState>;
  private root: HTMLElement;
  private player: VideoPlayer | null = null;
  private isHost = false;
  private endCheckTimer: ReturnType<typeof setInterval> | null = null;
  private loadedVideoId = "";
  private searchLoading = false;
  private videoEndedSent = false;
  private unavailableSentForVideoId = "";
  private unavailableCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSync: SyncPayload | null = null;
  private pendingForceSync = false;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private controlsTimer: ReturnType<typeof setInterval> | null = null;
  private isScrubbing = false;
  private playerLoading = false;
  private suppressStateBroadcast = 0;
  private ignoreRemotePlaybackUntil = 0;
  private applyingRemotePlayback = false;
  /** True while applying server playback (join, sync, video change) — block local echo to room. */
  private roomSyncInProgress = false;
  /** Block host player echo briefly after programmatic sync (load/buffer fires pause late). */
  private roomSyncGraceUntil = 0;
  /** True for full bootstrapSession (join / reconnect). */
  private sessionBootstrapInProgress = false;
  private lastVideoChangeAt = 0;
  private keepAliveStop: (() => void) | null = null;
  private networkRecoveryStop: (() => void) | null = null;
  private reconnectInFlight = false;
  private recoveryInProgress = false;
  private bootstrapPromise: Promise<void> | null = null;
  /** Playlist override until Colyseus state patch catches up after reconnect. */
  private queueSnapshot: QueueSnapshotItem[] | null = null;
  /** Set when roomJoined / reconnected has applied server-authoritative sync. */
  private sessionReady = false;
  private lastSessionSyncAt = 0;
  private lastPlaybackMessageAt = 0;
  private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
  private layoutMode: WatchLayoutMode = "desktop";
  private activeSheet: "playlist" | "search" | "viewers" | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private videoLoadRetries = new Map<string, number>();
  /** Suppress load/skip toasts when advancing past an unavailable video. */
  private suppressPlaybackToasts = false;
  private autoplayUnlockMode: "muted" | "blocked" | null = null;
  private autoplayCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private hostStallRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private ensurePlayerTask: Promise<void> | null = null;
  private destroyed = false;
  private manualRejoinAbort = false;
  private rejoinLeaveTimer: ReturnType<typeof setTimeout> | null = null;
  private documentClickHandler: ((e: Event) => void) | null = null;
  private applyingPlaybackClearTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(room: Room<WatchRoomState>, root: HTMLElement) {
    this.room = room;
    this.root = root;
    this.renderShell();
    const bufferedSession = takeBufferedSessionSync(this.room);
    this.bindRoomMessages();
    this.bindStateListeners();
    this.bindConnectionHandlers();
    this.setConnectionStatus("connected");
    if (bufferedSession) {
      this.handleSessionSync(bufferedSession);
    } else if (!this.sessionReady) {
      // roomJoined / reconnected carry authoritative sync; fallback if message was missed.
      setTimeout(() => {
        if (!this.sessionReady) void this.bootstrapSession();
      }, 300);
    }
  }

  private canEditQueue(): boolean {
    return this.isHost || this.room.state.allowEveryoneQueue;
  }

  private canControlPlayback(): boolean {
    return this.isHost || this.room.state.allowEveryonePlayback;
  }

  private dropdownOpen = false;
  private openQueueMenuIndex: number | null = null;
  private queueDragFrom: number | null = null;

  private static readonly QUEUE_GRIP_HTML = iconHtml("grip", 14, "ui-icon ui-icon--grip");

  private renderShell() {
    this.root.innerHTML = `
      <div class="watch-app">
        <div class="watch-content">
          <section class="watch-left">
            <div class="player-wrap">
              <div id="yt-player"></div>
              <div id="player-placeholder" class="player-placeholder">
                <p class="player-placeholder-text">
                  <span>Add videos from Search</span>
                  ${iconHtml("arrow-right", 16, "ui-icon ui-icon--inline")}
                </p>
              </div>
              <div id="player-controls" class="player-controls hidden" aria-label="Video controls">
                <div class="player-controls-gradient"></div>
                <div class="player-controls-bar">
                  <p id="player-controls-title" class="player-controls-title"></p>
                  <div class="player-controls-row">
                    <button type="button" id="player-skip-back" class="player-ctrl-btn" aria-label="Back 10 seconds" disabled>
                      ${iconHtml("skip-back", 18, "ui-icon")}
                    </button>
                    <button type="button" id="player-play-btn" class="player-ctrl-btn player-ctrl-btn--primary" aria-label="Play" disabled>
                      ${iconHtml("play", 20, "ui-icon")}
                    </button>
                    <button type="button" id="player-skip-fwd" class="player-ctrl-btn" aria-label="Forward 10 seconds" disabled>
                      ${iconHtml("skip", 18, "ui-icon")}
                    </button>
                    <span id="player-time-current" class="player-time">0:00</span>
                    <input type="range" id="player-seek" class="player-seek" min="0" max="0" value="0" step="0.1" disabled aria-label="Seek" />
                    <span id="player-time-duration" class="player-time">0:00</span>
                  </div>
                </div>
              </div>
              <div id="loading-overlay" class="player-loading hidden">
                <div class="loading-spinner"></div>
              </div>
              <button
                type="button"
                id="autoplay-unlock"
                class="autoplay-unlock hidden"
                aria-label="Tap to sync playback"
              >
                <span class="autoplay-unlock-icon">${iconHtml("play", 28, "ui-icon")}</span>
                <span id="autoplay-unlock-label" class="autoplay-unlock-label">Tap to sync playback</span>
              </button>
            </div>

            <section class="playlist-section">
              <div class="playlist-header">
                <div class="playlist-header-left">
                  <h2 class="playlist-title">Shared Playlist</h2>
                  <span id="queue-progress" class="queue-progress">Video 0/0</span>
                </div>
                <div class="playlist-header-right">
                  <button type="button" id="host-menu-btn" class="host-menu-btn">
                    <span id="host-menu-avatar" class="host-menu-avatar"></span>
                    <span id="host-menu-label">Viewers</span>
                    <span class="host-menu-chevron">${iconHtml("chevron-down", 14, "ui-icon")}</span>
                  </button>
                  <div id="host-dropdown" class="host-dropdown hidden">
                    <div class="host-dropdown-section">
                      <span id="connection-badge" class="connection-badge connected">Connected</span>
                    </div>
                    <div id="host-controls" class="host-controls">
                      <label class="switch-row switch-row--dropdown">
                        <span class="switch-label">
                          ${iconHtml("lock", 14, "ui-icon")}
                          Allow everyone to edit playlist &amp; playback
                        </span>
                        <input type="checkbox" id="perm-everyone" class="switch-input" checked />
                        <span class="switch-track"><span class="switch-thumb"></span></span>
                      </label>
                      <label class="switch-row switch-row--dropdown">
                        <span class="switch-label">Allow others to become host</span>
                        <input type="checkbox" id="perm-host" class="switch-input" />
                        <span class="switch-track"><span class="switch-thumb"></span></span>
                      </label>
                      <label class="switch-row switch-row--dropdown">
                        <span class="switch-label">Continue from next song in list</span>
                        <input type="checkbox" id="perm-continue-position" class="switch-input" checked />
                        <span class="switch-track"><span class="switch-thumb"></span></span>
                      </label>
                    </div>
                    <p class="host-dropdown-heading">Viewers</p>
                    <div class="viewers-scroll">
                      <ul id="members-list" class="dropdown-members"></ul>
                    </div>
                    <button id="claim-host-btn" type="button" class="claim-host-btn hidden">Become host</button>
                  </div>
                </div>
              </div>
              <ul id="queue-list" class="queue-list queue-list--vertical"></ul>
            </section>
          </section>

          <aside class="watch-right">
            <div class="yt-search-wrap">
              <input id="browse-input" type="text" placeholder="Search YouTube or paste a link" maxlength="500" />
              <button id="browse-action-btn" type="button" class="browse-action-btn browse-action-btn--search" aria-label="Search">${iconHtml("search", 18, "ui-icon")}</button>
            </div>
            <div class="yt-browse-scroll">
              <div id="yt-browse-grid" class="yt-browse-grid"></div>
              <div id="search-loader" class="search-loader hidden">
                <div class="loading-spinner"></div>
              </div>
            </div>
            <p id="search-empty" class="search-empty">Search YouTube or paste a video link</p>
          </aside>
        </div>

        <nav class="mobile-toolbar" aria-label="Open panels" hidden>
          <button type="button" id="open-playlist-sheet" class="mobile-toolbar-btn">
            ${iconHtml("list", 18, "ui-icon")}
            <span>Playlist</span>
          </button>
          <button type="button" id="open-search-sheet" class="mobile-toolbar-btn">
            ${iconHtml("search", 18, "ui-icon")}
            <span>Search</span>
          </button>
          <button type="button" id="open-viewers-sheet" class="mobile-toolbar-btn">
            ${iconHtml("users", 18, "ui-icon")}
            <span>Viewers</span>
          </button>
        </nav>

        <div id="sheet-backdrop" class="sheet-backdrop hidden" aria-hidden="true"></div>
      </div>
    `;

    this.root.querySelector("#browse-action-btn")?.addEventListener("click", () => this.handleBrowseAction());
    const browseInput = this.root.querySelector("#browse-input") as HTMLInputElement;
    browseInput?.addEventListener("input", () => this.updateBrowseActionButton());
    browseInput?.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") this.handleBrowseAction();
    });
    this.updateBrowseActionButton();
    this.root.querySelector("#claim-host-btn")?.addEventListener("click", () => {
      this.room.send("claimHost", {});
      this.closeDropdown();
    });

    this.root.querySelector("#host-menu-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    });

    this.root.querySelector("#host-dropdown")?.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    this.root.querySelector("#perm-everyone")?.addEventListener("change", (e) => {
      if (!this.isHost) return;
      const on = (e.target as HTMLInputElement).checked;
      this.room.send("setPermissions", { allowEveryoneQueue: on, allowEveryonePlayback: on });
    });
    this.root.querySelector("#perm-host")?.addEventListener("change", (e) => {
      if (!this.isHost) return;
      this.room.send("setPermissions", { allowOthersToHost: (e.target as HTMLInputElement).checked });
    });
    this.root.querySelector("#perm-continue-position")?.addEventListener("change", (e) => {
      if (!this.isHost) return;
      this.room.send("setPermissions", { continueFromPosition: (e.target as HTMLInputElement).checked });
    });

    this.documentClickHandler = () => {
      if (this.destroyed) return;
      this.closeDropdown();
      this.closeQueueMenu();
    };
    document.addEventListener("click", this.documentClickHandler);
    // Visibility recovery is handled by bindNetworkRecoveryHandlers in bindConnectionHandlers.

    this.bindKeyboardControls();
    this.bindPlayerControls();
    this.bindAutoplayUnlock();
    this.bindLayoutObserver();
    this.bindSheetControls();

    if (isRawIpHost()) {
      toast.show(
        "Some videos may not play over a raw IP address. Use localhost or your deployed URL for full playback.",
        "warning"
      );
    }
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  private blurActiveElement() {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }

  private bindKeyboardControls() {
    this.keyboardHandler = (e: KeyboardEvent) => this.handleKeyboard(e);
    document.addEventListener("keydown", this.keyboardHandler, true);
  }

  private handleKeyboard(e: KeyboardEvent) {
    if (this.isTypingTarget(e.target)) return;

    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      this.togglePlayPause();
      return;
    }

    if (!this.canControlPlayback() || !this.player) return;

    const step = e.shiftKey ? 10 : 5;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      const t = Math.max(0, this.player.getCurrentTime() - step);
      this.markLocalPlaybackAction();
      this.seekTo(t);
      this.room.send("seek", { currentTime: t });
      if (this.lastSync) this.lastSync = { ...this.lastSync, currentTime: t };
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      const duration = this.getEffectiveVideoDuration();
      const t =
        duration > 0
          ? Math.min(duration, this.player.getCurrentTime() + step)
          : this.player.getCurrentTime() + step;
      this.markLocalPlaybackAction();
      this.seekTo(t);
      this.room.send("seek", { currentTime: t });
      if (this.lastSync) this.lastSync = { ...this.lastSync, currentTime: t };
    }
  }

  private markLocalPlaybackAction(graceMs = LOCAL_SYNC_GRACE_MS) {
    this.ignoreRemotePlaybackUntil = Date.now() + graceMs;
  }

  private shouldIgnoreRemotePlaybackApply(): boolean {
    return this.canControlPlayback() && Date.now() < this.ignoreRemotePlaybackUntil;
  }

  /** Skip duplicate play/pause right after videoChanged already applied the same state. */
  private shouldSkipRedundantPlaybackApply(currentTime: number, shouldPlay: boolean): boolean {
    if (!this.player || Date.now() - this.lastVideoChangeAt > 3000) return false;
    const drift = Math.abs(this.player.getCurrentTime() - currentTime);
    if (drift > SYNC_APPLY_THRESHOLD) return false;
    return this.player.isPlaying() === shouldPlay;
  }

  private withSuppressedStateBroadcast(fn: () => void) {
    this.suppressStateBroadcast += 1;
    try {
      fn();
    } finally {
      setTimeout(() => {
        this.suppressStateBroadcast = Math.max(0, this.suppressStateBroadcast - 1);
      }, STATE_BROADCAST_SUPPRESS_MS);
    }
  }

  private isOwnPlaybackMessage(fromSessionId?: string): boolean {
    return !!fromSessionId && fromSessionId === this.room.sessionId;
  }

  private togglePlayPause() {
    this.blurActiveElement();
    if (!this.player || !this.canControlPlayback()) return;

    this.markLocalPlaybackAction();
    const currentTime = this.player.getCurrentTime();
    if (this.player.isPlaying()) {
      this.withSuppressedStateBroadcast(() => {
        this.player!.pause(currentTime);
      });
      this.room.send("pause", { currentTime });
    } else {
      this.videoEndedSent = false;
      this.withSuppressedStateBroadcast(() => {
        this.player!.play(currentTime);
      });
      this.room.send("play", { currentTime });
    }
    this.updatePlayerControls();
  }

  private skipRelative(seconds: number) {
    if (!this.player || !this.canControlPlayback()) return;
    const duration = this.getEffectiveVideoDuration();
    let t = this.player.getCurrentTime() + seconds;
    if (duration > 0) t = Math.min(duration, t);
    t = Math.max(0, t);
    this.markLocalPlaybackAction();
    this.seekTo(t);
    this.room.send("seek", { currentTime: t });
    this.updatePlayerControls();
  }

  private bindLayoutObserver() {
    const app = this.root.querySelector(".watch-app") as HTMLElement | null;
    if (!app) return;

    const apply = () => {
      const mode = detectWatchLayoutMode(app.clientWidth, app.clientHeight);
      if (mode !== this.layoutMode) {
        this.layoutMode = mode;
        if (mode === "desktop" || mode === "mini") this.closeSheets();
      }
      app.classList.remove("layout-desktop", "layout-compact", "layout-mini");
      app.classList.add(`layout-${mode}`);

      const toolbar = this.root.querySelector(".mobile-toolbar") as HTMLElement | null;
      if (toolbar) toolbar.hidden = mode !== "compact";

      const isTouch =
        mode !== "desktop" ||
        window.matchMedia("(hover: none), (pointer: coarse)").matches;
      this.root.querySelector(".player-wrap")?.classList.toggle("player-wrap--touch", isTouch);
    };

    apply();
    this.resizeObserver = new ResizeObserver(apply);
    this.resizeObserver.observe(app);
  }

  private bindSheetControls() {
    this.root.querySelector("#open-playlist-sheet")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleSheet("playlist");
    });
    this.root.querySelector("#open-search-sheet")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleSheet("search");
    });
    this.root.querySelector("#open-viewers-sheet")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleSheet("viewers");
    });
    this.root.querySelector("#sheet-backdrop")?.addEventListener("click", () => {
      this.closeSheets();
    });
  }

  private toggleSheet(sheet: "playlist" | "search" | "viewers") {
    if (this.activeSheet === sheet) {
      this.closeSheets();
      return;
    }
    this.openSheet(sheet);
  }

  private openSheet(sheet: "playlist" | "search" | "viewers") {
    const app = this.root.querySelector(".watch-app");
    if (!app || this.layoutMode !== "compact") return;

    this.activeSheet = sheet;
    app.classList.remove("sheet-open--playlist", "sheet-open--search", "sheet-open--viewers");
    app.classList.add(`sheet-open--${sheet}`);

    const backdrop = this.root.querySelector("#sheet-backdrop");
    backdrop?.classList.remove("hidden");
    backdrop?.setAttribute("aria-hidden", "false");

    if (sheet === "viewers") {
      this.dropdownOpen = true;
      this.root.querySelector("#host-dropdown")?.classList.remove("hidden");
    } else {
      this.closeDropdown();
    }

    this.root.querySelectorAll(".mobile-toolbar-btn").forEach((btn) => {
      btn.classList.toggle(
        "mobile-toolbar-btn--active",
        btn.id === `open-${sheet}-sheet`
      );
    });
  }

  private closeSheets() {
    this.activeSheet = null;
    const app = this.root.querySelector(".watch-app");
    app?.classList.remove("sheet-open--playlist", "sheet-open--search", "sheet-open--viewers");

    const backdrop = this.root.querySelector("#sheet-backdrop");
    backdrop?.classList.add("hidden");
    backdrop?.setAttribute("aria-hidden", "true");

    this.closeDropdown();
    this.root.querySelectorAll(".mobile-toolbar-btn--active").forEach((btn) => {
      btn.classList.remove("mobile-toolbar-btn--active");
    });
  }

  private bindAutoplayUnlock() {
    this.root.querySelector("#autoplay-unlock")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.unlockPlaybackFromGesture();
    });
  }

  private showAutoplayUnlock(mode: "muted" | "blocked") {
    if (!this.room.state.videoId || this.playerLoading) return;
    this.autoplayUnlockMode = mode;
    const btn = this.root.querySelector("#autoplay-unlock") as HTMLElement | null;
    const label = this.root.querySelector("#autoplay-unlock-label") as HTMLElement | null;
    if (!btn || !label) return;
    label.textContent = mode === "muted" ? "Tap for sound" : "Tap to sync playback";
    btn.classList.remove("hidden");
  }

  private hideAutoplayUnlock() {
    this.autoplayUnlockMode = null;
    this.root.querySelector("#autoplay-unlock")?.classList.add("hidden");
  }

  private scheduleAutoplayCheck() {
    if (this.autoplayCheckTimer) clearTimeout(this.autoplayCheckTimer);
    this.autoplayCheckTimer = setTimeout(() => {
      this.autoplayCheckTimer = null;
      this.checkAutoplayBlocked();
    }, 1500);
  }

  private checkAutoplayBlocked() {
    if (!this.player || !this.room.state.videoId || this.playerLoading || this.roomSyncInProgress) {
      return;
    }
    if (!this.room.state.isPlaying) {
      this.hideAutoplayUnlock();
      return;
    }
    if (this.player.isPlaying()) {
      if (this.player.isPlaybackMuted()) {
        this.showAutoplayUnlock("muted");
      } else {
        this.hideAutoplayUnlock();
      }
      return;
    }
    this.showAutoplayUnlock("blocked");
  }

  /** User gesture unlocks browser autoplay policy in Discord Activities. */
  private unlockPlaybackFromGesture() {
    if (!this.player || !this.room.state.videoId) return;

    this.hideAutoplayUnlock();
    const roomTime = this.getRoomEffectiveTime();
    this.player.unlockPlayback();

    if (this.room.state.isPlaying) {
      const drift = Math.abs(this.player.getCurrentTime() - roomTime);
      if (drift > SYNC_APPLY_THRESHOLD) {
        this.player.seek(roomTime, true);
      }
    }

    window.setTimeout(() => this.checkAutoplayBlocked(), 600);
  }

  private bindPlayerControls() {
    this.root.querySelector("#player-play-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.togglePlayPause();
    });
    this.root.querySelector("#player-skip-back")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.skipRelative(-10);
    });
    this.root.querySelector("#player-skip-fwd")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.skipRelative(10);
    });

    const seek = this.root.querySelector("#player-seek") as HTMLInputElement;
    seek?.addEventListener("pointerdown", () => {
      if (!this.canControlPlayback()) return;
      this.isScrubbing = true;
    });
    seek?.addEventListener("input", () => {
      if (!this.canControlPlayback()) return;
      const t = Number(seek.value);
      this.updatePlayerTimeLabels(t, Number(seek.max));
      this.withSuppressedStateBroadcast(() => {
        const keepPlaying = this.room.state.isPlaying || this.player!.isPlaying();
        this.player?.seek(t, keepPlaying);
      });
    });
    seek?.addEventListener("change", () => {
      if (!this.canControlPlayback()) return;
      const t = Number(seek.value);
      this.isScrubbing = false;
      this.markLocalPlaybackAction();
      this.seekTo(t);
      this.room.send("seek", { currentTime: t });
      if (this.lastSync) this.lastSync = { ...this.lastSync, currentTime: t };
    });

    this.root.querySelector(".player-wrap")?.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest(".player-controls-bar")) return;
      if (!this.canControlPlayback()) return;
      this.togglePlayPause();
    });
  }

  private updatePlayerTimeLabels(currentSec: number, durationSec: number) {
    const currentEl = this.root.querySelector("#player-time-current");
    const durationEl = this.root.querySelector("#player-time-duration");
    const currentLabel = formatDurationSeconds(Math.max(0, Math.floor(currentSec))) || "0:00";
    const durationLabel =
      durationSec > 0 ? formatDurationSeconds(Math.floor(durationSec)) || "0:00" : "--:--";
    if (currentEl) currentEl.textContent = currentLabel;
    if (durationEl) durationEl.textContent = durationLabel;
  }

  /** Shared room timeline — same for all users while watching together. */
  private getDisplayCurrentTime(): number {
    if (this.isScrubbing) {
      const seek = this.root.querySelector("#player-seek") as HTMLInputElement;
      return Number(seek?.value ?? 0);
    }

    if (this.room.state.videoId && this.room.state.lastUpdatedAt > 0) {
      return this.room.state.isPlaying
        ? this.getRoomEffectiveTime()
        : this.room.state.currentTime;
    }

    return this.player?.getCurrentTime() ?? 0;
  }

  private getEffectiveVideoDuration(): number {
    const playerDur = this.player?.getDuration() ?? 0;
    const roomDur = this.room.state.videoDurationSec;

    let queueDur = 0;
    this.room.state.queue?.forEach((item) => {
      if (item.status === "playing" && item.durationSec > queueDur) {
        queueDur = item.durationSec;
      }
    });

    return Math.max(playerDur, roomDur, queueDur);
  }

  private getSeekBarMax(duration: number, current: number): number {
    if (duration > 0) return duration;
    return Math.max(300, current + 60);
  }

  private updatePlayerControls() {
    const controls = this.root.querySelector("#player-controls");
    const hasVideo = !!this.room.state.videoId && !!this.player;

    controls?.classList.toggle("hidden", !hasVideo);
    if (!hasVideo || !this.player) return;

    const canControl = this.canControlPlayback();
    controls?.classList.toggle("player-controls--readonly", !canControl);

    const playBtn = this.root.querySelector("#player-play-btn") as HTMLButtonElement;
    const skipBack = this.root.querySelector("#player-skip-back") as HTMLButtonElement;
    const skipFwd = this.root.querySelector("#player-skip-fwd") as HTMLButtonElement;
    const seek = this.root.querySelector("#player-seek") as HTMLInputElement;
    const titleEl = this.root.querySelector("#player-controls-title");

    if (titleEl) titleEl.textContent = this.room.state.videoTitle || "";

    const playing = this.player.isPlaying();
    if (playBtn) {
      playBtn.disabled = !canControl;
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
      playBtn.innerHTML = iconHtml(playing ? "pause" : "play", 20, "ui-icon");
    }
    if (skipBack) skipBack.disabled = !canControl;
    if (skipFwd) skipFwd.disabled = !canControl;
    if (seek) seek.disabled = !canControl;

    const duration = this.getEffectiveVideoDuration();
    const current = this.getDisplayCurrentTime();
    const seekMax = this.getSeekBarMax(duration, current);

    if (seek && !this.isScrubbing) {
      seek.max = String(seekMax);
      seek.value = String(Math.min(seekMax, Math.max(0, current)));
    } else if (seek && this.isScrubbing) {
      seek.max = String(seekMax);
    }

    this.updatePlayerTimeLabels(current, duration);
  }

  private startControlsTimer() {
    if (this.controlsTimer) clearInterval(this.controlsTimer);
    this.controlsTimer = setInterval(() => this.updatePlayerControls(), 250);
  }

  private toggleDropdown() {
    this.dropdownOpen = !this.dropdownOpen;
    const dropdown = this.root.querySelector("#host-dropdown") as HTMLElement;
    dropdown?.classList.toggle("hidden", !this.dropdownOpen);
    if (this.dropdownOpen) {
      requestAnimationFrame(() => this.positionHostDropdown());
    } else {
      this.resetHostDropdownPosition();
    }
  }

  private positionHostDropdown() {
    const btn = this.root.querySelector("#host-menu-btn") as HTMLElement;
    const dropdown = this.root.querySelector("#host-dropdown") as HTMLElement;
    const scroll = this.root.querySelector(".viewers-scroll") as HTMLElement;
    if (!btn || !dropdown || dropdown.classList.contains("hidden")) return;

    const margin = 8;
    const rect = btn.getBoundingClientRect();

    dropdown.style.position = "fixed";
    dropdown.style.left = "auto";
    dropdown.style.width = `min(300px, calc(100vw - ${margin * 2}px))`;
    dropdown.style.maxHeight = `${window.innerHeight - margin * 2}px`;
    dropdown.style.right = `${Math.max(margin, window.innerWidth - rect.right)}px`;

    let top = rect.bottom + 6;
    dropdown.style.top = `${top}px`;
    dropdown.style.bottom = "auto";

    requestAnimationFrame(() => {
      const dropdownRect = dropdown.getBoundingClientRect();
      if (dropdownRect.bottom > window.innerHeight - margin) {
        const above = rect.top - dropdownRect.height - 6;
        if (above >= margin) {
          dropdown.style.top = `${above}px`;
        } else {
          dropdown.style.top = `${margin}px`;
        }
      }

      if (scroll) {
        const updated = dropdown.getBoundingClientRect();
        const reserved = updated.height - scroll.clientHeight;
        const available = window.innerHeight - margin - updated.top - reserved - 8;
        scroll.style.maxHeight = `${Math.max(96, Math.min(280, available))}px`;
      }
    });
  }

  private resetHostDropdownPosition() {
    const dropdown = this.root.querySelector("#host-dropdown") as HTMLElement;
    const scroll = this.root.querySelector(".viewers-scroll") as HTMLElement;
    if (!dropdown) return;
    dropdown.style.position = "";
    dropdown.style.top = "";
    dropdown.style.right = "";
    dropdown.style.bottom = "";
    dropdown.style.maxHeight = "";
    dropdown.style.width = "";
    if (scroll) scroll.style.maxHeight = "";
  }

  private closeDropdown() {
    this.dropdownOpen = false;
    this.resetHostDropdownPosition();
    this.root.querySelector("#host-dropdown")?.classList.add("hidden");
    if (this.activeSheet === "viewers") this.closeSheets();
  }

  private closeQueueMenu() {
    this.openQueueMenuIndex = null;
    this.root.querySelectorAll(".queue-menu").forEach((el) => el.classList.add("hidden"));
    this.root.querySelectorAll(".queue-menu-btn--open").forEach((el) => el.classList.remove("queue-menu-btn--open"));
  }

  private toggleQueueMenu(index: number, btn: HTMLButtonElement) {
    if (this.openQueueMenuIndex === index) {
      this.closeQueueMenu();
      return;
    }
    this.closeQueueMenu();
    this.openQueueMenuIndex = index;
    btn.classList.add("queue-menu-btn--open");
    btn.closest(".queue-row")?.querySelector(".queue-menu")?.classList.remove("hidden");
  }

  private getBrowseInput(): HTMLInputElement {
    return this.root.querySelector("#browse-input") as HTMLInputElement;
  }

  private isBrowseUrlInput(value: string): boolean {
    return isYouTubeLinkInput(value);
  }

  private updateBrowseActionButton() {
    const btn = this.root.querySelector("#browse-action-btn") as HTMLButtonElement;
    const input = this.getBrowseInput();
    if (!btn || !input) return;

    const urlMode = this.isBrowseUrlInput(input.value);
    btn.classList.toggle("browse-action-btn--add", urlMode);
    btn.classList.toggle("browse-action-btn--search", !urlMode);
    btn.setAttribute("aria-label", urlMode ? "Add to playlist" : "Search");

    if (urlMode) {
      btn.textContent = "Add";
    } else {
      btn.innerHTML = iconHtml("search", 18, "ui-icon");
    }
  }

  private handleBrowseAction() {
    const input = this.getBrowseInput();
    if (!input) return;
    if (this.isBrowseUrlInput(input.value)) {
      void this.handleUrlAdd();
    } else {
      void this.handleSearch();
    }
  }

  private async handleUrlAdd() {
    if (!this.canEditQueue()) return;
    const input = this.getBrowseInput().value.trim();
    if (!input) return;

    const playlistId = parsePlaylistId(input);
    if (playlistId && !parseYouTubeId(input)) {
      await this.handlePlaylistImport();
      return;
    }

    const videoId = parseYouTubeId(input);
    if (!videoId) {
      this.showStatus("Invalid YouTube URL", true);
      return;
    }
    const title = await fetchVideoTitle(videoId);
    const durationSec = await fetchVideoDurationSec(videoId);
    this.room.send("addToQueue", { videoId, title, durationSec });
    this.getBrowseInput().value = "";
    this.updateBrowseActionButton();
  }

  private showStatus(message: string, type: ToastType | boolean = "info") {
    if (this.suppressPlaybackToasts) return;
    const resolved: ToastType =
      typeof type === "boolean" ? (type ? "error" : "success") : type;
    toast.show(message, resolved);
  }

  /** Sync UI + playback from authoritative room state (join, reconnect, rejoin). */
  private bootstrapSession(force = false): Promise<void> {
    if (this.sessionBootstrapInProgress && !force) {
      return this.bootstrapPromise ?? Promise.resolve();
    }
    if (!force && this.bootstrapPromise) return this.bootstrapPromise;
    if (force) this.bootstrapPromise = null;
    this.bootstrapPromise = this.runBootstrapSession();
    return this.bootstrapPromise.finally(() => {
      this.bootstrapPromise = null;
    });
  }

  private async runBootstrapSession() {
    if (this.sessionBootstrapInProgress) return;
    this.sessionBootstrapInProgress = true;
    try {
      const isHost = this.room.state.hostSessionId === this.room.sessionId;
      this.setHostUI(isHost);
      this.lastSync = this.buildSyncFromRoom();
      this.refreshUI();

      if (!this.syncTimer) this.startSyncTimer();
      if (!this.endCheckTimer) this.startEndDetection();
      if (!this.controlsTimer) this.startControlsTimer();

      await this.applySync(this.lastSync, true);
      this.lastSync = this.buildSyncFromRoom();
      this.pendingForceSync = true;
      safeRoomSend(this.room, "syncRequest");
      this.sessionReady = true;
    } finally {
      this.sessionBootstrapInProgress = false;
      this.setRoomSyncGrace(this.isHost ? BOOTSTRAP_HOST_GRACE_MS : BOOTSTRAP_VIEWER_GRACE_MS);
    }
  }

  private setRoomSyncGrace(ms?: number) {
    const duration = ms ?? (this.isHost ? HOST_SYNC_GRACE_MS : VIEWER_SYNC_GRACE_MS);
    this.roomSyncGraceUntil = Date.now() + duration;
  }

  private markPlaybackMessageApplied() {
    this.lastPlaybackMessageAt = Date.now();
  }

  private shouldSkipSchemaDriftSync(): boolean {
    return Date.now() - this.lastPlaybackMessageAt < PLAYBACK_MESSAGE_GRACE_MS;
  }

  private applyQueueFromSync(sync: SyncPayload) {
    if (!Array.isArray(sync.queue)) return;
    this.queueSnapshot = sync.queue.length > 0 ? sync.queue : null;
  }

  private reconcileQueueSnapshot() {
    if (!this.queueSnapshot) return;
    const stateLen = this.room.state.queue?.length ?? 0;
    if (stateLen >= this.queueSnapshot.length) {
      this.queueSnapshot = null;
    }
  }

  private getDisplayQueueEntries(): { item: QueueSnapshotItem | QueueItem; index: number }[] {
    const stateQueue = this.room.state.queue;
    const stateLen = stateQueue?.length ?? 0;

    if (this.queueSnapshot?.length && stateLen < this.queueSnapshot.length) {
      return this.queueSnapshot.map((item, index) => ({ item, index }));
    }

    if (this.queueSnapshot && stateLen >= this.queueSnapshot.length) {
      this.queueSnapshot = null;
    }

    const entries: { item: QueueItem; index: number }[] = [];
    stateQueue?.forEach((item, index) => {
      entries.push({ item, index });
    });
    return entries;
  }

  private handleSessionSync(data: { isHost: boolean; sync: SyncPayload }) {
    this.sessionReady = true;
    this.lastSessionSyncAt = Date.now();
    this.setHostUI(data.isHost);
    this.applyQueueFromSync(data.sync);
    this.lastSync = data.sync;
    this.refreshUI();
    void this.applySync(data.sync, true).then(() => {
      this.lastSync = this.buildSyncFromRoom();
    });
    if (!this.syncTimer) this.startSyncTimer();
    if (!this.endCheckTimer) this.startEndDetection();
    if (!this.controlsTimer) this.startControlsTimer();
    this.pendingForceSync = true;
    safeRoomSend(this.room, "syncRequest");
  }

  private shouldBroadcastPlayerState(): boolean {
    // Only the host may push automatic player events (load/buffer/pause) to the room.
    if (!this.isHost) return false;
    if (
      this.sessionBootstrapInProgress ||
      this.playerLoading ||
      this.roomSyncInProgress ||
      Date.now() < this.roomSyncGraceUntil
    ) {
      return false;
    }
    if (this.suppressStateBroadcast > 0 || this.applyingRemotePlayback) return false;
    if (document.hidden) return false;
    return true;
  }

  private setConnectionStatus(state: "connected" | "connecting" | "disconnected") {
    const badge = this.root.querySelector("#connection-badge") as HTMLElement;
    badge.className = `connection-badge ${state}`;
    const labels = {
      connected: "Connected",
      connecting: "Connecting…",
      disconnected: "Disconnected",
    };
    badge.textContent = labels[state];
  }

  private setPlayerLoading(visible: boolean) {
    this.playerLoading = visible;
    this.root.querySelector("#loading-overlay")?.classList.toggle("hidden", !visible);
  }

  private bindConnectionHandlers() {
    configureRoomResilience(this.room);
    this.keepAliveStop = startRoomKeepAlive(this.room, () => this.requestRoomSync());
    this.networkRecoveryStop = bindNetworkRecoveryHandlers(this.room, () => {
      if (this.room.reconnection.isReconnecting) return;
      if (!this.room.connection?.isOpen) return;
      void this.recoverFromDisconnect();
    });

    this.room.onDrop(() => {
      this.setConnectionStatus("connecting");
    });

    this.room.onReconnect(() => {
      this.manualRejoinAbort = true;
      if (this.rejoinLeaveTimer) {
        clearTimeout(this.rejoinLeaveTimer);
        this.rejoinLeaveTimer = null;
      }
      this.reconnectInFlight = false;
      this.setConnectionStatus("connected");
      void this.recoverFromDisconnect();
    });

    this.room.onLeave((code) => {
      if (this.destroyed) return;
      if (this.reconnectInFlight) return;
      if (this.room.reconnection.isReconnecting) return;
      if (this.rejoinLeaveTimer) clearTimeout(this.rejoinLeaveTimer);
      this.rejoinLeaveTimer = setTimeout(() => {
        this.rejoinLeaveTimer = null;
        if (this.destroyed || this.manualRejoinAbort) return;
        if (this.reconnectInFlight) return;
        if (this.room.reconnection.isReconnecting) return;
        if (this.room.connection?.isOpen) return;
        void this.attemptRoomRejoin(code);
      }, 1200);
    });

    this.room.onError((_code, message) => {
      this.setConnectionStatus("connecting");
      console.warn("Room connection error:", message);
    });
  }

  private requestRoomSync() {
    this.pendingForceSync = true;
    safeRoomSend(this.room, "syncRequest");
  }

  private async recoverFromDisconnect() {
    if (this.recoveryInProgress || this.reconnectInFlight) return;
    if (this.room.reconnection.isReconnecting) return;
    if (!this.room.connection?.isOpen) return;

    this.recoveryInProgress = true;
    const syncAtStart = this.lastSessionSyncAt;
    try {
      this.ignoreRemotePlaybackUntil = 0;
      this.reconnectInFlight = false;
      this.setConnectionStatus("connected");
      await waitForWatchState(this.room, 6000);
      if (this.lastSessionSyncAt > syncAtStart) return;

      // Already in a session — resync playback only (avoid reloading on tab focus).
      if (this.sessionReady && this.room.state.videoId) {
        const sync = this.buildSyncFromRoom();
        this.lastSync = sync;
        await this.applySync(sync, true);
        this.requestRoomSync();
        this.scheduleAutoplayCheck();
        return;
      }

      await this.bootstrapSession(true);
      this.scheduleAutoplayCheck();
    } finally {
      this.recoveryInProgress = false;
    }
  }

  /** Room is still playing but the player stalled — resume locally and resync server clock. */
  private scheduleHostStallRecovery() {
    if (!this.isHost || !this.room.state.isPlaying) return;
    if (this.hostStallRecoveryTimer) return;

    this.hostStallRecoveryTimer = setTimeout(() => {
      this.hostStallRecoveryTimer = null;
      if (!this.player || !this.room.state.isPlaying || this.player.isPlaying()) return;
      if (this.roomSyncInProgress || this.playerLoading || this.applyingRemotePlayback) return;

      const roomTime = this.getRoomEffectiveTime();
      const localTime = this.player.getCurrentTime();
      const resumeTime = Math.abs(localTime - roomTime) > 2 ? roomTime : localTime;

      this.withSuppressedStateBroadcast(() => {
        this.player!.play(resumeTime);
      });
      safeRoomSend(this.room, "play", { currentTime: resumeTime });
    }, 180);
  }

  /** New host picks up authoritative playback (Watch Together style). */
  private async adoptHostPlayback() {
    if (!this.isHost || !this.room.state.videoId) return;

    this.setRoomSyncGrace(BOOTSTRAP_HOST_GRACE_MS);
    const sync = this.buildSyncFromRoom();
    this.lastSync = sync;
    await this.applySync(sync, true);

    if (!this.endCheckTimer) this.startEndDetection();
    if (sync.isPlaying) {
      this.scheduleAutoplayCheck();
      if (this.player && !this.player.isPlaying()) {
        this.scheduleHostStallRecovery();
      }
    }
  }

  private async attemptRoomRejoin(code: number) {
    if (this.destroyed) return;
    if (this.reconnectInFlight) return;
    if (this.manualRejoinAbort) return;
    if (this.room.connection?.isOpen) return;

    this.reconnectInFlight = true;
    this.setConnectionStatus("connecting");

    const channelId = discordSDK.channelId;
    if (!channelId) {
      this.reconnectInFlight = false;
      this.setConnectionStatus("disconnected");
      this.showStatus("Re-open the Activity from a voice channel to reconnect.", true);
      return;
    }

    for (let attempt = 0; attempt < 6; attempt++) {
      if (this.destroyed || this.manualRejoinAbort) {
        this.reconnectInFlight = false;
        return;
      }
      if (this.room.connection?.isOpen) {
        this.reconnectInFlight = false;
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));

      if (this.destroyed || this.manualRejoinAbort) {
        this.reconnectInFlight = false;
        return;
      }
      if (this.room.connection?.isOpen) {
        this.reconnectInFlight = false;
        return;
      }

      try {
        const newRoom = await joinWatchRoom(channelId);
        if (this.destroyed || this.manualRejoinAbort || this.room.connection?.isOpen) {
          this.reconnectInFlight = false;
          return;
        }
        configureRoomResilience(newRoom);
        await waitForWatchState(newRoom);
        await new Promise((r) => setTimeout(r, 0));
        persistWatchRoomId(channelId, newRoom.roomId);
        this.destroy();
        new WatchApp(newRoom, this.root);
        return;
      } catch (err) {
        console.warn(`Rejoin attempt ${attempt + 1} failed:`, err);
      }
    }

    this.reconnectInFlight = false;
    this.setConnectionStatus("disconnected");
    this.showStatus(`Connection lost (code ${code}). Re-open the Activity to reconnect.`, true);
  }

  private externalImg(src: string, className = "", lazy = false): string {
    const cls = className ? ` class="${className}"` : "";
    const loading = lazy ? ' loading="lazy"' : "";
    return `<img src="${this.escapeAttr(src)}" alt="" referrerpolicy="no-referrer"${cls}${loading} />`;
  }

  private setHostUI(isHost: boolean) {
    this.isHost = isHost;
    const label = this.root.querySelector("#host-menu-label") as HTMLElement;
    if (label) label.textContent = isHost ? "You are hosting" : "Viewers";

    this.updateHostMenuAvatar();

    const everyone = this.root.querySelector("#perm-everyone") as HTMLInputElement;
    const permHost = this.root.querySelector("#perm-host") as HTMLInputElement;
    const permContinue = this.root.querySelector("#perm-continue-position") as HTMLInputElement;
    if (everyone) {
      everyone.disabled = !isHost;
      everyone.closest(".switch-row")?.classList.toggle("switch-disabled", !isHost);
    }
    if (permHost) {
      permHost.disabled = !isHost;
      permHost.closest(".switch-row")?.classList.toggle("switch-disabled", !isHost);
    }
    if (permContinue) {
      permContinue.disabled = !isHost;
      permContinue.closest(".switch-row")?.classList.toggle("switch-disabled", !isHost);
    }

    this.root.querySelector("#host-controls")?.classList.toggle("hidden", !isHost);

    this.updatePermissionUI();
  }

  private updateHostMenuAvatar() {
    const el = this.root.querySelector("#host-menu-avatar") as HTMLElement;
    if (!el) return;

    const hostId = this.room.state.hostSessionId;
    const hostMember = hostId ? this.room.state.members?.get(hostId) : null;
    const me = this.room.state.members?.get(this.room.sessionId);
    const showMember = this.isHost ? me : hostMember;

    if (showMember?.avatarUrl) {
      el.innerHTML = this.externalImg(showMember.avatarUrl);
    } else if (showMember?.username) {
      el.textContent = showMember.username.charAt(0).toUpperCase();
    } else {
      el.textContent = "👤";
    }
  }

  private updatePermissionUI() {
    const s = this.room.state;

    const everyone = this.root.querySelector("#perm-everyone") as HTMLInputElement;
    if (everyone) {
      everyone.checked = s.allowEveryoneQueue && s.allowEveryonePlayback;
    }
    (this.root.querySelector("#perm-host") as HTMLInputElement).checked = s.allowOthersToHost;
    (this.root.querySelector("#perm-continue-position") as HTMLInputElement).checked = s.continueFromPosition;

    const canQueue = this.canEditQueue();

    (this.root.querySelector("#browse-input") as HTMLInputElement).disabled = !canQueue;
    (this.root.querySelector("#browse-action-btn") as HTMLButtonElement).disabled = !canQueue;

    this.root.querySelector("#claim-host-btn")?.classList.toggle(
      "hidden",
      this.isHost || !s.allowOthersToHost
    );

    this.renderBrowseInteractivity();
    this.updatePlayerControls();
  }

  private videoPayload(video: YouTubeVideoResult) {
    return {
      videoId: video.videoId,
      title: video.title,
      channelName: video.channel,
      durationSec: parseDurationToSeconds(video.duration),
    };
  }

  /** Browse: add to SyncTube playlist (not play in browse panel). */
  private addFromBrowse(video: YouTubeVideoResult, card?: HTMLElement) {
    if (!this.canEditQueue()) return;
    this.room.send("addToQueue", this.videoPayload(video));
    this.blurActiveElement();
    if (card) {
      card.classList.add("yt-browse-card--added");
      const btn = card.querySelector(".yt-add-icon");
      if (btn) btn.innerHTML = iconHtml("check", 16, "ui-icon");
      setTimeout(() => {
        card.classList.remove("yt-browse-card--added");
        if (btn) btn.innerHTML = iconHtml("plus", 16, "ui-icon");
      }, 1200);
    }
  }

  private async handlePlaylistImport(showOverlay = false) {
    if (!this.canEditQueue()) return;
    const input = this.getBrowseInput().value;
    const playlistId = parsePlaylistId(input);
    if (!playlistId) {
      this.showStatus("Invalid playlist URL or ID", true);
      return;
    }
    if (showOverlay) this.setPlayerLoading(true);
    try {
      const result = await importYouTubePlaylist(input.trim() || playlistId);
      if (result.items.length === 0) {
        this.showStatus(result.error ?? "Playlist is empty or private", true);
        return;
      }
      this.room.send("addBatchToQueue", {
        items: result.items.map((v) => this.videoPayload(v)),
      });
      this.getBrowseInput().value = "";
      this.updateBrowseActionButton();
    } catch (e) {
      this.showStatus(e instanceof Error ? e.message : "Playlist import failed", true);
    } finally {
      if (showOverlay) this.setPlayerLoading(false);
    }
  }

  private async handleSearch() {
    if (this.searchLoading) return;
    const input = this.getBrowseInput();
    const query = input.value.trim();

    if (this.isBrowseUrlInput(query)) {
      await this.handleUrlAdd();
      return;
    }

    if (query.length < 2) {
      this.showStatus("Enter at least 2 characters to search", true);
      return;
    }

    this.searchLoading = true;
    const btn = this.root.querySelector("#browse-action-btn") as HTMLButtonElement;
    const loader = this.root.querySelector("#search-loader") as HTMLElement;
    const grid = this.root.querySelector("#yt-browse-grid") as HTMLElement;

    btn.disabled = true;
    loader.classList.remove("hidden");
    grid.innerHTML = "";
    this.root.querySelector("#search-empty")?.classList.add("hidden");

    try {
      const result = await searchYouTube(query);
      this.renderSearchResults(result.items);
      this.root.querySelector("#search-empty")?.classList.toggle("hidden", result.items.length > 0);
      if (result.items.length === 0) {
        this.showStatus(result.error ?? "No videos found", true);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Search failed";
      this.showStatus(msg, true);
      this.root.querySelector("#search-empty")?.classList.remove("hidden");
    } finally {
      this.searchLoading = false;
      loader.classList.add("hidden");
      btn.disabled = false;
    }
  }

  private renderSearchResults(items: YouTubeVideoResult[]) {
    const grid = this.root.querySelector("#yt-browse-grid") as HTMLElement;
    grid.innerHTML = "";

    for (const video of items) {
      const card = document.createElement("article");
      card.className = "yt-browse-card";
      const thumbUrl = getYouTubeThumbnail(video.videoId);

      card.innerHTML = `
        <div class="yt-browse-thumb-wrap">
          ${this.externalImg(thumbUrl, "yt-browse-thumb", true)}
          ${video.duration ? `<span class="yt-browse-duration">${this.escapeHtml(video.duration)}</span>` : ""}
          <div class="yt-add-queue-overlay">
            <button type="button" class="yt-add-queue-btn" aria-label="Add to playlist">
              <span class="yt-add-icon">${iconHtml("plus", 16, "ui-icon")}</span>
              <span class="yt-add-text">Add to playlist</span>
            </button>
          </div>
        </div>
        <div class="yt-browse-meta">
          <span class="yt-browse-title">${this.escapeHtml(video.title)}</span>
          <span class="yt-browse-channel">${this.escapeHtml(video.channel)}</span>
        </div>
      `;

      card.querySelector(".yt-add-queue-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.addFromBrowse(video, card);
        (e.currentTarget as HTMLElement)?.blur();
      });

      grid.appendChild(card);
    }

    this.root.querySelector("#search-empty")?.classList.toggle("hidden", grid.children.length > 0);
    this.renderBrowseInteractivity();
  }

  private renderBrowseInteractivity() {
    const canQueue = this.canEditQueue();
    this.root.querySelectorAll(".yt-browse-card").forEach((card) => {
      card.classList.toggle("browse-disabled", !canQueue);
      const btn = card.querySelector(".yt-add-queue-btn") as HTMLButtonElement | null;
      if (btn) btn.disabled = !canQueue;
    });
    (this.root.querySelector("#browse-input") as HTMLInputElement).disabled = !canQueue;
    (this.root.querySelector("#browse-action-btn") as HTMLButtonElement).disabled = !canQueue;
  }

  private getRoomEffectiveTime(): number {
    const s = this.room.state;
    if (!s.isPlaying) return s.currentTime;
    const elapsed = (Date.now() - s.lastUpdatedAt) / 1000;
    return s.currentTime + elapsed * s.playbackRate;
  }

  private buildSyncFromRoom(): SyncPayload {
    const s = this.room.state;
    return {
      videoId: s.videoId,
      videoTitle: s.videoTitle,
      currentTime: this.getRoomEffectiveTime(),
      isPlaying: s.isPlaying,
      playbackRate: s.playbackRate,
      hostSessionId: s.hostSessionId,
      videoDurationSec: s.videoDurationSec,
      allowEveryoneQueue: s.allowEveryoneQueue,
      allowEveryonePlayback: s.allowEveryonePlayback,
      allowOthersToHost: s.allowOthersToHost,
      allowReplayPlayed: s.allowReplayPlayed,
      dimPlayedInPlaylist: s.dimPlayedInPlaylist,
      continueFromPosition: s.continueFromPosition,
    };
  }

  private handlePlayerError(errorCode: number) {
    if (!this.isHost) return;
    if (errorCode === 100 || errorCode === 101) {
      this.signalVideoUnavailable(errorCode);
      return;
    }
    void this.retryPlaybackOrDeferUnavailable(errorCode);
  }

  private async retryPlaybackOrDeferUnavailable(errorCode?: number) {
    const videoId = this.room.state.videoId;
    if (!videoId) return;

    const attempts = this.videoLoadRetries.get(videoId) ?? 0;
    if (attempts < MAX_VIDEO_LOAD_RETRIES) {
      this.videoLoadRetries.set(videoId, attempts + 1);
      this.unavailableSentForVideoId = "";
      if (!this.suppressPlaybackToasts) {
        toast.show("Video is loading slowly — retrying…", "warning");
      }

      await new Promise((r) => setTimeout(r, 2000));
      if (this.room.state.videoId !== videoId) return;

      this.loadedVideoId = "";
      const sync = this.lastSync ?? this.buildSyncFromRoom();
      try {
        await this.ensurePlayer(videoId, {
          startTime: sync.currentTime,
          autoplay: sync.isPlaying,
        });
        if (sync.isPlaying) this.scheduleUnavailableCheck();
        return;
      } catch {
        /* fall through to deferred check */
      }
    }

    this.scheduleUnavailableCheck(true, errorCode);
    if (!this.suppressPlaybackToasts) {
      this.showStatus("Could not load this video. Skipping when possible.", true);
    }
  }

  private clearUnavailableCheck() {
    if (this.unavailableCheckTimer) {
      clearTimeout(this.unavailableCheckTimer);
      this.unavailableCheckTimer = null;
    }
  }

  private isVideoActuallyPlaying(): boolean {
    if (!this.player) return false;
    const state = this.player.getLastState();
    if (state === "playing" || state === "buffering") return true;
    if (this.player.getDuration() > 0 && this.player.getCurrentTime() > 0.5) return true;
    return this.player.getCurrentTime() > 1;
  }

  private scheduleUnavailableCheck(deferred = false, errorCode?: number) {
    this.clearUnavailableCheck();
    const videoId = this.room.state.videoId;
    // One reporter avoids duplicate skip races; host is authoritative for playback.
    if (!videoId || !this.isHost) return;

    const delay = deferred ? 12_000 : UNAVAILABLE_CHECK_MS;

    this.unavailableCheckTimer = setTimeout(() => {
      this.unavailableCheckTimer = null;
      if (!this.player || this.room.state.videoId !== videoId) return;
      if (this.unavailableSentForVideoId === videoId || this.videoEndedSent) return;
      if (this.playerLoading) {
        this.scheduleUnavailableCheck(deferred, errorCode);
        return;
      }
      if (this.isVideoActuallyPlaying()) return;

      this.signalVideoUnavailable(errorCode);
    }, delay);
  }

  /** Host / controller reports unplayable videos so the room skips ahead. */
  private signalVideoUnavailable(errorCode?: number) {
    if (!this.isHost) return;
    const videoId = this.room.state.videoId;
    if (!videoId || this.unavailableSentForVideoId === videoId) return;

    this.unavailableSentForVideoId = videoId;
    this.videoEndedSent = true;
    this.suppressPlaybackToasts = true;
    this.clearUnavailableCheck();

    this.room.send("videoUnavailable", { errorCode: errorCode ?? 0 });
  }

  private handlePlayerStateChange(state: YtPlayerState, currentTime: number) {
    if (!this.player) return;

    if (state === "playing" || state === "paused" || state === "buffering") {
      this.clearUnavailableCheck();
      if (state === "playing") {
        this.videoLoadRetries.delete(this.room.state.videoId);
        if (this.player?.isPlaybackMuted()) {
          this.showAutoplayUnlock("muted");
        } else {
          this.hideAutoplayUnlock();
        }
      }
    }

    this.reportDurationToServer();
    this.updatePlayerControls();

    if (state === "ended") {
      this.signalVideoEnded();
      return;
    }

    if (state === "paused" && this.room.state.isPlaying) {
      // Transient buffer stall — don't pause the room for everyone.
      if (this.isHost) this.scheduleHostStallRecovery();
      return;
    }

    if (!this.shouldBroadcastPlayerState()) return;

    if (state === "playing") {
      this.videoEndedSent = false;
      this.room.send("play", { currentTime });
    } else if (state === "paused") {
      this.room.send("pause", { currentTime });
    }
  }

  private signalVideoEnded() {
    if (this.videoEndedSent || !this.isHost) return;
    this.videoEndedSent = true;
    this.room.send("videoEnded", {});
  }

  private reportDurationToServer(durationSec?: number) {
    if (!this.canControlPlayback()) return;
    const duration = durationSec ?? this.player?.getDuration() ?? 0;
    if (duration <= 0) return;

    const roomDur = this.room.state.videoDurationSec;
    if (roomDur > 0 && duration <= roomDur) return;

    this.room.send("setVideoDuration", { durationSec: Math.floor(duration) });
  }

  private handlePlayerDurationChange(durationSec: number) {
    this.reportDurationToServer(durationSec);
    this.updatePlayerControls();
    this.renderQueue();
  }

  private prefetchVideoDuration(videoId: string) {
    if (!videoId) return;
    void fetchVideoDurationSec(videoId).then((durationSec) => {
      if (durationSec > 0 && this.room.state.videoId === videoId) {
        this.reportDurationToServer(durationSec);
        this.updatePlayerControls();
        this.renderQueue();
      }
    });
  }

  private bindRoomMessages() {
    this.room.onMessage("roomJoined", (data: { isHost: boolean; sync: SyncPayload }) => {
      if (this.sessionReady) return;
      this.handleSessionSync(data);
    });

    this.room.onMessage("reconnected", (data: { isHost: boolean; sync: SyncPayload }) => {
      const wasHost = this.isHost;
      this.handleSessionSync(data);
      if (data.isHost && !wasHost) {
        void this.adoptHostPlayback();
      } else if (data.isHost && wasHost) {
        void this.adoptHostPlayback();
      } else if (!data.isHost && wasHost) {
        this.clearUnavailableCheck();
      }
    });

    this.room.onMessage("queueEmpty", () => {
      this.queueSnapshot = null;
      this.suppressPlaybackToasts = false;
      this.renderQueue();
      this.renderVideoTitle();
      this.updatePlayerControls();
    });

    this.room.onMessage("videoSkipped", (data: { reason?: string }) => {
      if (data.reason === "unavailable") {
        this.suppressPlaybackToasts = true;
      }
    });

    this.room.onMessage("play", (data: { currentTime: number; fromSessionId?: string }) => {
      this.videoEndedSent = false;
      if (this.lastSync) {
        this.lastSync = { ...this.lastSync, currentTime: data.currentTime, isPlaying: true };
      }
      if (this.isHost && !this.room.state.allowEveryonePlayback) {
        this.updatePlayerControls();
        return;
      }
      if (this.isOwnPlaybackMessage(data.fromSessionId)) {
        this.updatePlayerControls();
        return;
      }
      if (this.shouldSkipRedundantPlaybackApply(data.currentTime, true)) {
        this.updatePlayerControls();
        return;
      }
      if (!this.shouldIgnoreRemotePlaybackApply()) {
        this.markPlaybackMessageApplied();
        this.applyPlay(data.currentTime);
      }
      this.updatePlayerControls();
    });

    this.room.onMessage("pause", (data: { currentTime: number; fromSessionId?: string }) => {
      if (this.lastSync) {
        this.lastSync = { ...this.lastSync, currentTime: data.currentTime, isPlaying: false };
      }
      if (this.isHost && !this.room.state.allowEveryonePlayback) {
        this.updatePlayerControls();
        return;
      }
      if (this.isOwnPlaybackMessage(data.fromSessionId)) {
        this.updatePlayerControls();
        return;
      }
      if (this.shouldSkipRedundantPlaybackApply(data.currentTime, false)) {
        this.updatePlayerControls();
        return;
      }
      if (!this.shouldIgnoreRemotePlaybackApply()) {
        this.markPlaybackMessageApplied();
        this.applyPause(data.currentTime);
      }
      this.updatePlayerControls();
    });

    this.room.onMessage("seek", (data: { currentTime: number; fromSessionId?: string }) => {
      if (this.lastSync) {
        this.lastSync = { ...this.lastSync, currentTime: data.currentTime };
      }
      if (this.isOwnPlaybackMessage(data.fromSessionId)) {
        this.updatePlayerControls();
        return;
      }
      if (!this.shouldIgnoreRemotePlaybackApply()) {
        this.markPlaybackMessageApplied();
        this.seekTo(data.currentTime, this.room.state.isPlaying);
      }
      this.updatePlayerControls();
    });

    this.room.onMessage("setRate", (data: { rate: number; currentTime: number }) => {
      this.seekTo(data.currentTime);
      this.player?.setPlaybackRate(data.rate);
    });

    this.room.onMessage("videoChanged", (sync: SyncPayload) => {
      this.videoEndedSent = false;
      this.unavailableSentForVideoId = "";
      this.videoLoadRetries.delete(sync.videoId);
      this.ignoreRemotePlaybackUntil = 0;
      this.lastVideoChangeAt = Date.now();
      this.markPlaybackMessageApplied();
      this.clearUnavailableCheck();
      this.lastSync = sync;
      void this.applyVideoChange(sync).finally(() => {
        this.suppressPlaybackToasts = false;
      });
    });

    this.room.onMessage("sync", (sync: SyncPayload) => {
      const force = this.pendingForceSync;
      this.pendingForceSync = false;
      this.applyQueueFromSync(sync);
      this.lastSync = sync;
      this.applySync(sync, force);
    });

    this.room.onMessage("forceSync", (sync: SyncPayload) => {
      this.applyQueueFromSync(sync);
      this.lastSync = sync;
      this.applySync(sync, true);
    });

    this.room.onMessage("hostChanged", (data: { hostSessionId: string }) => {
      const wasHost = this.isHost;
      const isHost = data.hostSessionId === this.room.sessionId;
      this.setHostUI(isHost);
      const newHost = this.room.state.members?.get(data.hostSessionId);
      if (isHost) {
        this.showStatus("You are now the host", "success");
        if (!wasHost) void this.adoptHostPlayback();
      } else if (wasHost && newHost) {
        this.clearUnavailableCheck();
        this.showStatus(`Host transferred to ${newHost.username}`, "info");
      }
      this.renderMembers();
      this.updateHostMenuAvatar();
      this.pendingForceSync = true;
      safeRoomSend(this.room, "syncRequest");
    });

    this.room.onMessage("permissionsChanged", (_perms: PermissionsPayload) => {
      this.updatePermissionUI();
      this.renderBrowseInteractivity();
      this.renderQueue();
    });
  }

  private bindStateListeners() {
    const callbacks = Callbacks.get(this.room);

    if (this.room.state.members) {
      callbacks.onAdd("members", () => this.renderMembers());
      callbacks.onRemove("members", () => this.renderMembers());
    }
    if (this.room.state.queue) {
      callbacks.onAdd("queue", () => {
        this.reconcileQueueSnapshot();
        this.renderQueue();
      });
      callbacks.onRemove("queue", () => {
        this.reconcileQueueSnapshot();
        this.renderQueue();
      });
      callbacks.onChange("queue", () => {
        this.reconcileQueueSnapshot();
        this.renderQueue();
      });
    }

    callbacks.onChange(this.room.state, () => {
      this.reconcileQueueSnapshot();
      this.renderQueue();
      this.renderVideoTitle();
      this.updatePermissionUI();
    });

    this.bindPlaybackStateListeners(callbacks);
  }

  private bindPlaybackStateListeners(callbacks: ReturnType<typeof Callbacks.get>) {
    const state = this.room.state;
    const listen = callbacks.listen.bind(callbacks) as (
      instance: WatchRoomState,
      property: keyof WatchRoomState,
      handler: () => void,
      immediate?: boolean
    ) => () => void;

    // Playback position comes from play/pause/seek messages + drift timer — not schema listeners.
    listen(state, "videoDurationSec", () => {
      this.updatePlayerControls();
      this.renderQueue();
    }, false);
  }

  private refreshUI() {
    this.renderMembers();
    this.renderQueue();
    this.renderVideoTitle();
    this.updatePermissionUI();
    this.updateHostMenuAvatar();
  }

  private renderMembers() {
    const list = this.root.querySelector("#members-list") as HTMLUListElement;
    if (!list) return;
    list.innerHTML = "";

    const members = this.room.state.members;
    if (!members?.forEach) return;

    members.forEach((member, sessionId) => {
      const li = document.createElement("li");
      const isRoomHost = sessionId === this.room.state.hostSessionId;
      const isMe = sessionId === this.room.sessionId;
      const avatar = member.avatarUrl
        ? this.externalImg(member.avatarUrl, "dropdown-avatar")
        : `<span class="dropdown-avatar dropdown-avatar--fallback">${this.escapeHtml(member.username.charAt(0).toUpperCase())}</span>`;

      li.innerHTML = `
        ${avatar}
        <span class="dropdown-member-name">${this.escapeHtml(member.username)}${isMe ? " (You)" : ""}</span>
        ${
          isRoomHost
            ? '<span class="dropdown-host-badge">HOST</span>'
            : this.isHost
              ? `<button type="button" class="make-host-btn">Make host</button>`
              : ""
        }
      `;

      if (this.isHost && !isRoomHost) {
        li.querySelector(".make-host-btn")?.addEventListener("click", (e) => {
          e.stopPropagation();
          this.room.send("transferHost", { sessionId });
          this.closeDropdown();
        });
      }

      list.appendChild(li);
    });

    if (this.dropdownOpen) {
      requestAnimationFrame(() => this.positionHostDropdown());
    }

    this.updateHostMenuAvatar();
  }

  private resolveQueueMember(item: QueueSnapshotItem | QueueItem): Member | null {
    const members = this.room.state.members;
    if (!members) return null;

    if (item.addedBySessionId && members.has(item.addedBySessionId)) {
      return members.get(item.addedBySessionId)!;
    }

    let found: Member | null = null;
    members.forEach((member) => {
      if (!found && member.username === item.addedBy) found = member;
    });
    return found;
  }

  private renderQueueUserHtml(item: QueueSnapshotItem | QueueItem): string {
    const member = this.resolveQueueMember(item);
    const name = member?.username || item.addedBy || "Guest";
    const initial = name.charAt(0).toUpperCase();

    if (member?.avatarUrl) {
      return `
        <div class="queue-row-user">
          ${this.externalImg(member.avatarUrl, "queue-row-user-avatar")}
          <span class="queue-row-user-name">${this.escapeHtml(name)}</span>
        </div>
      `;
    }

    return `
      <div class="queue-row-user">
        <span class="queue-row-user-avatar queue-row-user-avatar--fallback">${this.escapeHtml(initial)}</span>
        <span class="queue-row-user-name">${this.escapeHtml(name)}</span>
      </div>
    `;
  }

  private clearQueueDragIndicators() {
    this.root.querySelectorAll(".queue-row").forEach((el) => {
      el.classList.remove("queue-drag-over", "queue-drag-over--before", "queue-drag-over--after");
    });
    this.root.querySelector("#queue-list")?.classList.remove("queue-list--dragging");
  }

  private bindQueueDragDrop(li: HTMLLIElement, index: number, status: string) {
    const canEdit = this.canEditQueue();
    const list = li.closest("#queue-list") as HTMLUListElement | null;
    const handle = li.querySelector(
      ".queue-drag-handle:not(.queue-drag-handle--playing)"
    ) as HTMLElement | null;

    if (canEdit && (status === "queued" || status === "played") && handle) {
      handle.draggable = true;

      handle.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        this.queueDragFrom = index;
        e.dataTransfer!.effectAllowed = "move";
        e.dataTransfer!.setData("text/plain", String(index));
        if (e.dataTransfer?.setDragImage) {
          e.dataTransfer.setDragImage(li, 48, 24);
        }
        li.classList.add("queue-dragging");
        list?.classList.add("queue-list--dragging");
      });

      handle.addEventListener("dragend", () => {
        this.queueDragFrom = null;
        li.classList.remove("queue-dragging");
        this.clearQueueDragIndicators();
      });
    }

    if (!canEdit || (status !== "queued" && status !== "playing" && status !== "played")) return;

    li.addEventListener("dragover", (e) => {
      if (this.queueDragFrom === null) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";

      const rect = li.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;

      this.root.querySelectorAll(".queue-row").forEach((row) => {
        row.classList.remove("queue-drag-over", "queue-drag-over--before", "queue-drag-over--after");
      });

      li.classList.add("queue-drag-over");
      li.classList.add(after ? "queue-drag-over--after" : "queue-drag-over--before");
    });

    li.addEventListener("dragleave", (e) => {
      if (!li.contains(e.relatedTarget as Node)) {
        li.classList.remove("queue-drag-over", "queue-drag-over--before", "queue-drag-over--after");
      }
    });

    li.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.clearQueueDragIndicators();

      const from = Number(e.dataTransfer!.getData("text/plain"));
      if (!Number.isInteger(from)) return;

      const queueLen = this.room.state.queue?.length ?? 0;
      if (queueLen === 0) return;

      const rect = li.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;

      let toIndex = index;
      if (status === "playing") {
        toIndex = index + 1;
      } else if (after) {
        toIndex = index + 1;
      }

      if (after && index === queueLen - 1) {
        toIndex = queueLen;
      } else if (toIndex >= queueLen) {
        toIndex = queueLen - 1;
      }

      const targetItem = this.room.state.queue?.[toIndex];
      if (targetItem?.status === "playing") {
        toIndex = Math.min(index + 1, queueLen - 1);
      }

      if (from === toIndex) return;

      this.queueDragFrom = null;
      this.room.send("moveQueueItem", { fromIndex: from, toIndex });
    });
  }

  private renderQueue() {
    const list = this.root.querySelector("#queue-list") as HTMLUListElement;
    if (!list) return;

    const prevMenuIndex = this.openQueueMenuIndex;
    list.innerHTML = "";
    this.openQueueMenuIndex = null;

    const queue = this.room.state.queue;
    if (!queue?.forEach && !this.queueSnapshot?.length) return;

    let total = 0;
    let playingPos = 0;

    for (const { item, index } of this.getDisplayQueueEntries()) {
      total += 1;
      if (item.status === "playing") playingPos = total;

      const li = document.createElement("li");
      li.className = `queue-row queue-${item.status}`;
      li.dataset.index = String(index);

      const thumbUrl = getYouTubeThumbnail(item.videoId);
      const duration = formatDurationSeconds(item.durationSec);
      const displayNum = total;
      const canEdit = this.canEditQueue();
      const canPlayback = this.canControlPlayback();
      const isQueued = item.status === "queued";
      const isPlaying = item.status === "playing";
      const isPlayed = item.status === "played";
      const isUnavailable = item.status === "unavailable";
      const canPlayItem = canPlayback && !isPlaying && !isUnavailable && (isQueued || isPlayed);
      const showMenu = canEdit && (isQueued || isPlayed);

      const grip = WatchApp.QUEUE_GRIP_HTML;
      const canReorder = canEdit && (isQueued || isPlayed);
      const leadCol = isPlaying
        ? `<div class="queue-row-lead"><span class="queue-row-status-icon queue-row-status-icon--playing" aria-hidden="true">${iconHtml("play", 14, "ui-icon")}</span></div>`
        : canReorder
          ? `<div class="queue-row-lead"><span class="queue-drag-handle" title="Drag to reorder">${grip}</span><span class="queue-row-index">${displayNum}</span></div>`
          : `<div class="queue-row-lead"><span class="queue-row-index">${displayNum}</span></div>`;

      const channelLine = item.channelName
        ? `<span class="queue-row-channel">${this.escapeHtml(item.channelName)}</span>`
        : "";

      const thumbOverlay = isUnavailable
        ? `<span class="queue-unavailable-badge">Unavailable</span>`
        : isPlaying
          ? `<span class="queue-row-playing-badge">Playing</span>`
          : canPlayItem
            ? `<button type="button" class="queue-thumb-play" aria-label="Play this video">
                  <span class="queue-thumb-play-icon">${iconHtml("play", 14, "ui-icon")}</span>
                </button>`
            : "";

      const menuBlock = showMenu
        ? `
          <button type="button" class="queue-menu-btn" aria-label="Queue options">${iconHtml("more-vertical", 18, "ui-icon")}</button>
          <div class="queue-menu hidden">
            <button type="button" class="queue-menu-item queue-menu-item--delete">
              ${iconHtml("trash", 14, "ui-icon ui-icon--inline")} Delete
            </button>
            ${
              isQueued
                ? `<button type="button" class="queue-menu-item queue-menu-item--play-next">
                    ${iconHtml("play", 14, "ui-icon ui-icon--inline")} Play next
                  </button>`
                : `<button type="button" class="queue-menu-item queue-menu-item--play-now">
                    ${iconHtml("play", 14, "ui-icon ui-icon--inline")} Play
                  </button>`
            }
          </div>
        `
        : canEdit && isUnavailable
          ? `<button type="button" class="queue-delete-btn" aria-label="Remove from playlist">${iconHtml("trash", 16, "ui-icon")}</button>`
          : "";

      li.innerHTML = `
        ${leadCol}
        <div class="queue-row-thumb-wrap${canPlayItem ? " queue-row-thumb-wrap--playable" : ""}${isUnavailable ? " queue-row-thumb-wrap--unavailable" : ""}${isPlaying ? " queue-row-thumb-wrap--active" : ""}">
          ${this.externalImg(thumbUrl, `queue-row-thumb${isUnavailable ? " queue-row-thumb--dimmed" : ""}${isPlaying ? " queue-row-thumb--dimmed" : ""}`, true)}
          ${duration ? `<span class="queue-row-duration">${this.escapeHtml(duration)}</span>` : ""}
          ${thumbOverlay}
        </div>
        <div class="queue-row-body">
          <span class="queue-row-title">${this.escapeHtml(item.title || item.videoId)}</span>
          ${channelLine}
          ${this.renderQueueUserHtml(item)}
        </div>
        ${menuBlock}
      `;

      if (canPlayItem) {
        const playFromRow = () => {
          this.videoEndedSent = false;
          this.unavailableSentForVideoId = "";
          this.room.send("playQueueItem", { index });
        };
        li.querySelector(".queue-thumb-play")?.addEventListener("click", (e) => {
          e.stopPropagation();
          playFromRow();
        });
        li.querySelector(".queue-row-body")?.addEventListener("click", () => playFromRow());
      }

      if (canEdit && isUnavailable) {
        li.querySelector(".queue-delete-btn")?.addEventListener("click", (e) => {
          e.stopPropagation();
          this.room.send("removeFromQueue", { index });
        });
      }

      if (showMenu) {
        const menuBtn = li.querySelector(".queue-menu-btn") as HTMLButtonElement;
        menuBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggleQueueMenu(index, menuBtn);
        });

        const menu = li.querySelector(".queue-menu") as HTMLElement;
        menu.addEventListener("click", (e) => e.stopPropagation());

        li.querySelector(".queue-menu-item--delete")?.addEventListener("click", () => {
          this.room.send("removeFromQueue", { index });
          this.closeQueueMenu();
        });
        li.querySelector(".queue-menu-item--play-next")?.addEventListener("click", () => {
          this.room.send("playNextInQueue", { index });
          this.closeQueueMenu();
        });
        li.querySelector(".queue-menu-item--play-now")?.addEventListener("click", () => {
          this.videoEndedSent = false;
          this.unavailableSentForVideoId = "";
          this.room.send("playQueueItem", { index });
          this.closeQueueMenu();
        });
      }

      this.bindQueueDragDrop(li, index, item.status);
      list.appendChild(li);
    }

    if (prevMenuIndex !== null) {
      const row = list.querySelector(`[data-index="${prevMenuIndex}"]`);
      const btn = row?.querySelector(".queue-menu-btn") as HTMLButtonElement | null;
      if (btn) this.toggleQueueMenu(prevMenuIndex, btn);
    }

    const progress = this.root.querySelector("#queue-progress");
    if (progress) {
      progress.textContent = total > 0 ? `Video ${playingPos || 1}/${total}` : "Video 0/0";
    }
  }

  private renderVideoTitle() {
    this.root.querySelector("#player-placeholder")?.classList.toggle("hidden", !!this.room.state.videoId);
    this.updatePlayerControls();
  }

  private async applyVideoChange(sync: SyncPayload) {
    this.roomSyncInProgress = true;
    try {
      const previousVideoId = this.loadedVideoId;
      if (!sync.videoId) {
        this.loadedVideoId = "";
        this.lastSync = sync;
        this.renderVideoTitle();
        this.renderQueue();
        this.clearUnavailableCheck();
        return;
      }

      if (sync.videoId !== previousVideoId) {
        this.loadedVideoId = "";
      }

      await this.ensurePlayer(sync.videoId, {
        startTime: sync.currentTime,
        autoplay: false,
      });

      if (!this.player || !sync.videoId) return;

      if (this.player.waitForReady) {
        await this.player.waitForReady();
      }

      this.prefetchVideoDuration(sync.videoId);
      this.lastSync = sync;

      if (sync.isPlaying) {
        this.applyPlay(sync.currentTime);
        if (this.canControlPlayback()) this.markLocalPlaybackAction();
        if (this.isHost) this.scheduleUnavailableCheck();
      } else {
        this.applyPause(sync.currentTime);
      }

      this.renderVideoTitle();
      this.renderQueue();
    } finally {
      this.roomSyncInProgress = false;
      this.setRoomSyncGrace();
    }
  }

  private async ensurePlayer(
    videoId: string,
    options: { startTime?: number; autoplay?: boolean } = {}
  ): Promise<void> {
    if (!videoId) return;

    const run = () => this.runEnsurePlayer(videoId, options);
    if (this.ensurePlayerTask) {
      await this.ensurePlayerTask.catch(() => undefined);
    }
    const task = run();
    this.ensurePlayerTask = task;
    try {
      await task;
    } finally {
      if (this.ensurePlayerTask === task) {
        this.ensurePlayerTask = null;
      }
    }
  }

  private async runEnsurePlayer(
    videoId: string,
    options: { startTime?: number; autoplay?: boolean } = {}
  ): Promise<void> {
    const startTime = options.startTime ?? 0;
    const autoplay = options.autoplay ?? false;
    const container = this.root.querySelector("#yt-player") as HTMLElement;

    if (this.player && this.loadedVideoId === videoId) {
      const resumeTime = options.startTime ?? this.player.getCurrentTime();
      const shouldPlay = options.autoplay ?? this.player.isPlaying();
      if (shouldPlay) {
        this.player.play(resumeTime);
      } else {
        this.player.pause(resumeTime);
      }
      return;
    }

    if (!this.player) {
      container.innerHTML = '<div id="yt-iframe-target"></div>';
      this.setPlayerLoading(true);
      try {
        this.player = await createYouTubePlayer("yt-iframe-target", {
          onStateChange: (state, currentTime) => this.handlePlayerStateChange(state, currentTime),
          onDurationChange: (durationSec) => this.handlePlayerDurationChange(durationSec),
          onError: (code) => this.handlePlayerError(code),
          onAutoplayBlocked: (mode) => this.showAutoplayUnlock(mode),
        });
        this.player.load(videoId, startTime, autoplay);
        await this.player.waitForReady();
        this.loadedVideoId = videoId;
        this.prefetchVideoDuration(videoId);
        this.reportDurationToServer();
        if (autoplay) this.scheduleUnavailableCheck();
      } catch {
        this.loadedVideoId = "";
        void this.retryPlaybackOrDeferUnavailable();
      } finally {
        this.setPlayerLoading(false);
      }
      return;
    }

    this.setPlayerLoading(true);
    try {
      this.player.load(videoId, startTime, autoplay);
      await this.player.waitForReady();
      this.loadedVideoId = videoId;
      this.prefetchVideoDuration(videoId);
      this.reportDurationToServer();
      if (autoplay) this.scheduleUnavailableCheck();
    } catch {
      this.loadedVideoId = "";
      void this.retryPlaybackOrDeferUnavailable();
    } finally {
      this.setPlayerLoading(false);
    }
  }

  private async applySync(sync: SyncPayload, force: boolean) {
    if (!sync.videoId) {
      this.renderVideoTitle();
      return;
    }

    this.roomSyncInProgress = true;
    try {
      const videoChanged = sync.videoId !== this.loadedVideoId;
      await this.ensurePlayer(sync.videoId, {
        startTime: sync.currentTime,
        autoplay: false,
      });
      if (!this.player || !sync.videoId) return;

      if (this.player.waitForReady) {
        await this.player.waitForReady();
      }

      this.prefetchVideoDuration(sync.videoId);

      this.lastSync = sync;
      const localTime = this.player.getCurrentTime();
      const drift = Math.abs(localTime - sync.currentTime);
      const needsUpdate = force || drift > SYNC_APPLY_THRESHOLD;
      const playingMismatch = this.player.isPlaying() !== sync.isPlaying;

      if (sync.playbackRate) {
        this.player.setPlaybackRate(sync.playbackRate);
      }

      if (sync.isPlaying) {
        if (needsUpdate || playingMismatch || videoChanged) {
          this.applyPlay(sync.currentTime);
          if (videoChanged && this.canControlPlayback()) this.markLocalPlaybackAction();
        }
        if (videoChanged && this.isHost) {
          this.scheduleUnavailableCheck();
        }
      } else if (needsUpdate || playingMismatch || videoChanged) {
        this.applyPause(sync.currentTime);
      }

      this.renderVideoTitle();
      this.renderQueue();
      if (force) {
        this.lastSync = this.buildSyncFromRoom();
      }
    } finally {
      this.roomSyncInProgress = false;
      this.setRoomSyncGrace();
    }
  }

  private clearApplyingRemotePlaybackLater() {
    if (this.applyingPlaybackClearTimer) {
      clearTimeout(this.applyingPlaybackClearTimer);
    }
    this.applyingPlaybackClearTimer = setTimeout(() => {
      this.applyingPlaybackClearTimer = null;
      this.applyingRemotePlayback = false;
    }, STATE_BROADCAST_SUPPRESS_MS);
  }

  private applyPlay(currentTime: number) {
    if (!this.player) return;
    this.applyingRemotePlayback = true;
    this.withSuppressedStateBroadcast(() => {
      const drift = Math.abs(this.player!.getCurrentTime() - currentTime);
      const playing = this.player!.isPlaying();
      if (playing && drift <= SYNC_APPLY_THRESHOLD) return;
      if (drift > SYNC_APPLY_THRESHOLD) {
        this.player!.seek(currentTime, true);
      }
      if (!this.player!.isPlaying()) {
        this.player!.play();
      }
    });
    this.clearApplyingRemotePlaybackLater();
    if (this.room.state.isPlaying) {
      this.scheduleAutoplayCheck();
    }
  }

  private applyPause(currentTime: number) {
    if (!this.player) return;
    this.hideAutoplayUnlock();
    this.applyingRemotePlayback = true;
    this.withSuppressedStateBroadcast(() => {
      const drift = Math.abs(this.player!.getCurrentTime() - currentTime);
      if (drift > SYNC_APPLY_THRESHOLD) {
        this.player!.seek(currentTime, false);
      }
      if (this.player!.isPlaying()) {
        this.player!.pause();
      }
    });
    this.clearApplyingRemotePlaybackLater();
  }

  private seekTo(time: number, keepPlaying?: boolean) {
    if (!this.player) return;
    const resume = keepPlaying ?? this.room.state.isPlaying;
    this.applyingRemotePlayback = true;
    this.withSuppressedStateBroadcast(() => {
      if (Math.abs(this.player!.getCurrentTime() - time) <= 0.05) return;
      this.player!.seek(time, resume);
    });
    this.clearApplyingRemotePlaybackLater();
  }

  private startSyncTimer() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => {
      if (!this.player || !this.lastSync || !this.room.state.videoId) return;
      if (this.roomSyncInProgress || this.playerLoading) return;

      const roomPlaying = this.room.state.isPlaying;
      const playingMismatch = this.player.isPlaying() !== roomPlaying;

      if (this.isHost) {
        if (roomPlaying && !this.player.isPlaying()) {
          this.scheduleHostStallRecovery();
        }
        return;
      }

      if (this.shouldIgnoreRemotePlaybackApply()) return;

      const roomTime = this.getRoomEffectiveTime();
      const localTime = this.player.getCurrentTime();
      const drift = Math.abs(localTime - roomTime);

      if (this.shouldSkipSchemaDriftSync() && drift <= SYNC_APPLY_THRESHOLD && !playingMismatch) {
        return;
      }

      if (drift > SYNC_APPLY_THRESHOLD || playingMismatch) {
        if (drift > 2) {
          safeRoomSend(this.room, "syncReport", { currentTime: localTime });
        }
        void this.applySync(
          {
            ...this.buildSyncFromRoom(),
            currentTime: roomTime,
            isPlaying: roomPlaying,
          },
          drift > 1.5 || playingMismatch
        ).then(() => {
          if (playingMismatch) this.scheduleAutoplayCheck();
        });
      }
    }, DRIFT_CHECK_INTERVAL_MS);
  }

  private startEndDetection() {
    if (this.endCheckTimer) clearInterval(this.endCheckTimer);
    this.endCheckTimer = setInterval(() => {
      if (!this.player || this.videoEndedSent || this.playerLoading) return;
      if (!this.isHost) return;

      if (this.player.getLastState() === "ended") {
        this.signalVideoEnded();
        return;
      }

      this.reportDurationToServer();

      const duration = this.getEffectiveVideoDuration();
      if (duration <= 10 || !this.player.isPlaying()) return;

      const current = this.getDisplayCurrentTime();
      if (current >= duration - 1.5) {
        this.signalVideoEnded();
      }
    }, END_CHECK_INTERVAL_MS);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private escapeAttr(text: string): string {
    return text.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  destroy() {
    this.destroyed = true;
    this.manualRejoinAbort = true;
    if (this.rejoinLeaveTimer) {
      clearTimeout(this.rejoinLeaveTimer);
      this.rejoinLeaveTimer = null;
    }
    if (this.keyboardHandler) {
      document.removeEventListener("keydown", this.keyboardHandler, true);
      this.keyboardHandler = null;
    }
    if (this.documentClickHandler) {
      document.removeEventListener("click", this.documentClickHandler);
      this.documentClickHandler = null;
    }
    if (this.hostStallRecoveryTimer) {
      clearTimeout(this.hostStallRecoveryTimer);
      this.hostStallRecoveryTimer = null;
    }
    if (this.applyingPlaybackClearTimer) {
      clearTimeout(this.applyingPlaybackClearTimer);
      this.applyingPlaybackClearTimer = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.keepAliveStop?.();
    this.keepAliveStop = null;
    this.networkRecoveryStop?.();
    this.networkRecoveryStop = null;
    if (this.controlsTimer) clearInterval(this.controlsTimer);
    this.clearUnavailableCheck();
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.endCheckTimer) clearInterval(this.endCheckTimer);
    if (this.autoplayCheckTimer) clearTimeout(this.autoplayCheckTimer);
    this.player?.destroy();
    try {
      if (this.room.connection?.isOpen) {
        void this.room.leave();
      }
    } catch {
      /* room already closed */
    }
  }
}
