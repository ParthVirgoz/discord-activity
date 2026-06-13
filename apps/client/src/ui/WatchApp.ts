import type { Room } from "@colyseus/sdk";
import { Callbacks } from "@colyseus/sdk";
import type { WatchRoomState, QueueItem, Member } from "../schema.js";
import { createYouTubePlayer, type VideoPlayer, type YtPlayerState } from "../youtube/YouTubePlayer.js";
import { parseYouTubeId, parsePlaylistId, isYouTubeLinkInput, fetchVideoTitle, parseDurationToSeconds, formatDurationSeconds, getYouTubeThumbnail } from "../utils/youtube.js";
import { isRawIpHost } from "../utils/youtubeEmbed.js";
import {
  searchYouTube,
  importYouTubePlaylist,
  type YouTubeVideoResult,
} from "../utils/api.js";
import { iconHtml } from "../utils/icons.js";
import { toast, type ToastType } from "../utils/toast.js";
import { isDiscordActivity } from "../utils/discordUrls.js";
import { configureRoomResilience, startRoomKeepAlive } from "../utils/roomConnection.js";

const DRIFT_CHECK_INTERVAL_MS = 5000;
const END_CHECK_INTERVAL_MS = 2000;
const SYNC_APPLY_THRESHOLD = 0.5;
/** Ignore echoed play/pause/seek from the room after local controller actions. */
const LOCAL_SYNC_GRACE_MS = 2500;
/** Only push controller drift to the room when clearly out of sync. */
const CONTROLLER_DRIFT_PUSH_SEC = 2.5;
/** Piped stream lookup + proxy can take 15s+ in Discord — don't mark unavailable too early. */
const UNAVAILABLE_CHECK_MS = isDiscordActivity() ? 35_000 : 8_000;

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
  private lastVideoChangeAt = 0;
  private keepAliveStop: (() => void) | null = null;
  private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(room: Room<WatchRoomState>, root: HTMLElement) {
    this.room = room;
    this.root = root;
    this.renderShell();
    this.bindRoomMessages();
    this.bindStateListeners();
    this.bindConnectionHandlers();
    this.setConnectionStatus("connected");
    this.updatePermissionUI();
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
                  <span>Add videos from the search panel</span>
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
                        <input type="checkbox" id="perm-everyone" class="switch-input" />
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

    document.addEventListener("click", () => {
      this.closeDropdown();
      this.closeQueueMenu();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") return;

      if (this.canControlPlayback()) {
        this.withSuppressedStateBroadcast(() => {
          void this.applySync(this.buildSyncFromRoom(), false);
        });
      } else {
        this.pendingForceSync = true;
        this.room.send("syncRequest", {});
      }
    });

    this.bindKeyboardControls();
    this.bindPlayerControls();

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
      queueMicrotask(() => {
        this.suppressStateBroadcast = Math.max(0, this.suppressStateBroadcast - 1);
      });
    }
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
    if (currentEl) currentEl.textContent = formatDurationSeconds(Math.floor(currentSec));
    if (durationEl) durationEl.textContent = formatDurationSeconds(Math.floor(durationSec));
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
    const current = this.isScrubbing
      ? Number(seek?.value ?? 0)
      : canControl
        ? this.player.getCurrentTime()
        : this.getRoomEffectiveTime();

    if (seek && duration > 0 && !this.isScrubbing) {
      seek.max = String(duration);
      seek.value = String(Math.min(duration, Math.max(0, current)));
    } else if (seek && duration > 0 && this.isScrubbing) {
      seek.max = String(duration);
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
    this.room.send("addToQueue", { videoId, title, durationSec: 0 });
    this.getBrowseInput().value = "";
    this.updateBrowseActionButton();
  }

  private showStatus(message: string, type: ToastType | boolean = "info") {
    const resolved: ToastType =
      typeof type === "boolean" ? (type ? "error" : "success") : type;
    toast.show(message, resolved);
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
    this.keepAliveStop = startRoomKeepAlive(this.room);

    this.room.onDrop(() => {
      this.setConnectionStatus("connecting");
    });

    this.room.onReconnect(() => {
      this.setConnectionStatus("connected");
      this.pendingForceSync = true;
      this.room.send("syncRequest", {});
    });

    this.room.onLeave((code) => {
      this.setConnectionStatus("disconnected");
      if (this.room.reconnection.isReconnecting) return;
      this.showStatus(`Disconnected (code ${code}). Re-open the Activity to reconnect.`, true);
    });

    this.room.onError((code, message) => {
      if (this.room.reconnection.isReconnecting) {
        this.setConnectionStatus("connecting");
        return;
      }
      this.setConnectionStatus("disconnected");
      this.showStatus(`Connection error (${code}): ${message ?? "Unknown"}`, true);
    });
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
    (this.root.querySelector("#browse-input") as HTMLInputElement).disabled = false;
    (this.root.querySelector("#browse-action-btn") as HTMLButtonElement).disabled = false;
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
    };
  }

  /** Push actual YouTube player state to the room (host / permitted users). */
  private syncPlaybackToRoom() {
    if (!this.player || !this.canControlPlayback()) return;
    const currentTime = this.player.getCurrentTime();
    if (this.player.isPlaying()) {
      this.room.send("play", { currentTime });
    } else {
      this.room.send("pause", { currentTime });
    }
  }

  private handlePlayerError(errorCode: number) {
    this.signalVideoUnavailable(errorCode);
  }

  private clearUnavailableCheck() {
    if (this.unavailableCheckTimer) {
      clearTimeout(this.unavailableCheckTimer);
      this.unavailableCheckTimer = null;
    }
  }

  private scheduleUnavailableCheck() {
    this.clearUnavailableCheck();
    const videoId = this.room.state.videoId;
    if (!videoId) return;

    this.unavailableCheckTimer = setTimeout(() => {
      this.unavailableCheckTimer = null;
      if (!this.player || this.room.state.videoId !== videoId) return;
      if (this.unavailableSentForVideoId === videoId || this.videoEndedSent) return;

      const duration = this.player.getDuration();
      const state = this.player.getLastState();
      if (duration > 0 || state === "playing" || state === "paused" || state === "buffering") {
        return;
      }

      this.signalVideoUnavailable();
    }, UNAVAILABLE_CHECK_MS);
  }

  /** Host / controller reports unplayable videos so the room skips ahead. */
  private signalVideoUnavailable(errorCode?: number) {
    if (!this.canControlPlayback()) return;
    const videoId = this.room.state.videoId;
    if (!videoId || this.unavailableSentForVideoId === videoId) return;

    this.unavailableSentForVideoId = videoId;
    this.videoEndedSent = true;
    this.clearUnavailableCheck();

    this.room.send("videoUnavailable", { errorCode: errorCode ?? 0 });
  }

  private handlePlayerStateChange(state: YtPlayerState, currentTime: number) {
    if (!this.player) return;

    if (state === "playing" || state === "paused" || state === "buffering") {
      this.clearUnavailableCheck();
    }

    this.reportDurationToServer();
    this.updatePlayerControls();

    if (state === "ended") {
      this.signalVideoEnded();
      return;
    }

    // Browser background tab pauses video — don't broadcast that to the room.
    if (document.hidden && this.canControlPlayback()) return;

    // Ignore state events triggered by our own applyPlay/applyPause/seekTo.
    if (this.suppressStateBroadcast > 0) return;

    if (!this.canControlPlayback()) {
      void this.applySync(this.buildSyncFromRoom(), true);
      return;
    }

    if (state === "playing") {
      this.videoEndedSent = false;
      this.room.send("play", { currentTime });
    } else if (state === "paused") {
      this.room.send("pause", { currentTime });
    }
  }

  private signalVideoEnded() {
    if (this.videoEndedSent || !this.canControlPlayback()) return;
    this.videoEndedSent = true;
    this.room.send("videoEnded", {});
  }

  private reportDurationToServer() {
    if (!this.player) return;
    const duration = this.player.getDuration();
    if (duration <= 0) return;
    if (this.room.state.videoDurationSec > 0) return;
    this.room.send("setVideoDuration", { durationSec: Math.floor(duration) });
  }

  private getEffectiveVideoDuration(): number {
    if (this.room.state.videoDurationSec > 0) return this.room.state.videoDurationSec;

    const queue = this.room.state.queue;
    if (queue?.forEach) {
      let fromQueue = 0;
      queue.forEach((item) => {
        if (item.status === "playing" && item.durationSec > 0) {
          fromQueue = item.durationSec;
        }
      });
      if (fromQueue > 0) return fromQueue;
    }

    return this.player?.getDuration() ?? 0;
  }

  private bindRoomMessages() {
    this.room.onMessage("roomJoined", (data: { isHost: boolean; sync: SyncPayload }) => {
      this.setHostUI(data.isHost);
      this.lastSync = data.sync;
      this.refreshUI();
      this.applySync(data.sync, true);
      this.startSyncTimer();
      this.startEndDetection();
      this.startControlsTimer();
    });

    this.room.onMessage("play", (data: { currentTime: number }) => {
      this.videoEndedSent = false;
      if (this.lastSync) {
        this.lastSync = { ...this.lastSync, currentTime: data.currentTime, isPlaying: true };
      }
      if (this.shouldSkipRedundantPlaybackApply(data.currentTime, true)) {
        this.updatePlayerControls();
        return;
      }
      if (!this.shouldIgnoreRemotePlaybackApply()) {
        this.applyPlay(data.currentTime);
      }
      this.updatePlayerControls();
    });

    this.room.onMessage("pause", (data: { currentTime: number }) => {
      if (this.lastSync) {
        this.lastSync = { ...this.lastSync, currentTime: data.currentTime, isPlaying: false };
      }
      if (this.shouldSkipRedundantPlaybackApply(data.currentTime, false)) {
        this.updatePlayerControls();
        return;
      }
      if (!this.shouldIgnoreRemotePlaybackApply()) {
        this.applyPause(data.currentTime);
      }
      this.updatePlayerControls();
    });

    this.room.onMessage("seek", (data: { currentTime: number }) => {
      if (this.lastSync) this.lastSync = { ...this.lastSync, currentTime: data.currentTime };
      if (!this.shouldIgnoreRemotePlaybackApply()) {
        this.seekTo(data.currentTime);
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
      this.ignoreRemotePlaybackUntil = 0;
      this.lastVideoChangeAt = Date.now();
      this.clearUnavailableCheck();
      this.lastSync = sync;
      void this.applyVideoChange(sync);
    });

    this.room.onMessage("sync", (sync: SyncPayload) => {
      const force = this.pendingForceSync;
      this.pendingForceSync = false;
      this.lastSync = sync;
      this.applySync(sync, force);
    });

    this.room.onMessage("forceSync", (sync: SyncPayload) => {
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
      } else if (wasHost && newHost) {
        this.showStatus(`Host transferred to ${newHost.username}`, "info");
      }
      this.renderMembers();
      this.updateHostMenuAvatar();
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
      callbacks.onAdd("queue", () => this.renderQueue());
      callbacks.onRemove("queue", () => this.renderQueue());
      callbacks.onChange("queue", () => this.renderQueue());
    }

    callbacks.onChange(this.room.state, () => {
      this.renderQueue();
      this.renderVideoTitle();
      this.updatePermissionUI();
    });
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

  private resolveQueueMember(item: QueueItem): Member | null {
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

  private renderQueueUserHtml(item: QueueItem): string {
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

      if (toIndex >= queueLen) toIndex = queueLen - 1;

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
    if (!queue?.forEach) return;

    let total = 0;
    let playingPos = 0;

    queue.forEach((item: QueueItem, index: number) => {
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
    });

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
      startTime: 0,
      autoplay: false,
    });

    if (!this.player || !sync.videoId) return;

    this.lastSync = sync;

    if (sync.isPlaying) {
      this.applyPlay(0);
      if (this.canControlPlayback()) this.markLocalPlaybackAction();
      this.scheduleUnavailableCheck();
    } else {
      this.applyPause(0);
    }

    this.renderVideoTitle();
    this.renderQueue();
  }

  private async ensurePlayer(
    videoId: string,
    options: { startTime?: number; autoplay?: boolean } = {}
  ): Promise<void> {
    if (!videoId) return;

    const startTime = options.startTime ?? 0;
    const autoplay = options.autoplay ?? false;
    const container = this.root.querySelector("#yt-player") as HTMLElement;

    if (this.player && this.loadedVideoId === videoId) {
      return;
    }

    if (!this.player) {
      container.innerHTML = '<div id="yt-iframe-target"></div>';
      this.setPlayerLoading(true);
      try {
        this.player = await createYouTubePlayer("yt-iframe-target", {
          onStateChange: (state, currentTime) => this.handlePlayerStateChange(state, currentTime),
          onError: (code) => this.handlePlayerError(code),
        });
        this.player.load(videoId, startTime, autoplay);
        await this.player.waitForReady();
        this.loadedVideoId = videoId;
        if (autoplay) this.scheduleUnavailableCheck();
      } catch {
        this.showStatus("Failed to load YouTube player. Try another video.", true);
        this.signalVideoUnavailable();
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
      if (autoplay) this.scheduleUnavailableCheck();
    } catch {
      this.showStatus("Failed to load YouTube player. Try another video.", true);
      this.signalVideoUnavailable();
    } finally {
      this.setPlayerLoading(false);
    }
  }

  private async applySync(sync: SyncPayload, force: boolean) {
    const videoChanged = sync.videoId !== this.loadedVideoId;
    await this.ensurePlayer(sync.videoId, {
      startTime: sync.currentTime,
      autoplay: false,
    });
    if (!this.player || !sync.videoId) return;

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
      if (videoChanged) {
        this.scheduleUnavailableCheck();
      }
    } else if (needsUpdate || playingMismatch || videoChanged) {
      this.applyPause(sync.currentTime);
    }

    this.renderVideoTitle();
  }

  private applyPlay(currentTime: number) {
    if (!this.player) return;
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
  }

  private applyPause(currentTime: number) {
    if (!this.player) return;
    this.withSuppressedStateBroadcast(() => {
      const drift = Math.abs(this.player!.getCurrentTime() - currentTime);
      if (drift > SYNC_APPLY_THRESHOLD) {
        this.player!.seek(currentTime, false);
      }
      if (this.player!.isPlaying()) {
        this.player!.pause();
      }
    });
  }

  private seekTo(time: number) {
    if (!this.player) return;
    const keepPlaying = this.room.state.isPlaying || this.player.isPlaying();
    this.withSuppressedStateBroadcast(() => {
      if (Math.abs(this.player!.getCurrentTime() - time) <= 0.05) return;
      this.player!.seek(time, keepPlaying);
    });
  }

  private startSyncTimer() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => {
      if (!this.player || !this.lastSync) return;

      if (this.canControlPlayback()) {
        if (Date.now() < this.ignoreRemotePlaybackUntil) return;

        const roomTime = this.getRoomEffectiveTime();
        const localTime = this.player.getCurrentTime();
        const roomPlaying = this.room.state.isPlaying;
        const drift = Math.abs(localTime - roomTime);
        const playingMismatch = this.player.isPlaying() !== roomPlaying;

        if (drift > CONTROLLER_DRIFT_PUSH_SEC || playingMismatch) {
          this.markLocalPlaybackAction(1000);
          this.syncPlaybackToRoom();
        }
        return;
      }

      const serverTime = this.getRoomEffectiveTime();
      const localTime = this.player.getCurrentTime();
      const drift = Math.abs(localTime - serverTime);
      const roomPlaying = this.room.state.isPlaying;

      if (drift > SYNC_APPLY_THRESHOLD || this.player.isPlaying() !== roomPlaying) {
        void this.applySync(
          {
            ...this.lastSync,
            currentTime: serverTime,
            isPlaying: roomPlaying,
          },
          true
        );
      }
    }, DRIFT_CHECK_INTERVAL_MS);
  }

  private startEndDetection() {
    if (this.endCheckTimer) clearInterval(this.endCheckTimer);
    this.endCheckTimer = setInterval(() => {
      if (!this.player || this.videoEndedSent || this.playerLoading) return;
      if (!this.canControlPlayback()) return;

      if (this.player.getLastState() === "ended") {
        this.signalVideoEnded();
        return;
      }

      this.reportDurationToServer();

      const duration = this.getEffectiveVideoDuration();
      if (duration <= 0) return;

      const current = this.player.getCurrentTime();
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
    if (this.keyboardHandler) {
      document.removeEventListener("keydown", this.keyboardHandler, true);
    }
    this.keepAliveStop?.();
    this.keepAliveStop = null;
    if (this.controlsTimer) clearInterval(this.controlsTimer);
    this.clearUnavailableCheck();
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.endCheckTimer) clearInterval(this.endCheckTimer);
    this.player?.destroy();
  }
}
