import type { Room } from "@colyseus/sdk";
import { Callbacks } from "@colyseus/sdk";
import type { WatchRoomState, QueueItem } from "../schema.js";
import { createYouTubePlayer, type VideoPlayer } from "../youtube/YouTubePlayer.js";
import { parseYouTubeId, parsePlaylistId, fetchVideoTitle } from "../utils/youtube.js";
import {
  searchYouTube,
  importYouTubePlaylist,
  type YouTubeVideoResult,
} from "../utils/api.js";

const DRIFT_CHECK_INTERVAL_MS = 5000;
const SYNC_APPLY_THRESHOLD = 0.5;

export interface SyncPayload {
  videoId: string;
  videoTitle: string;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  hostSessionId: string;
}

export class WatchApp {
  private room: Room<WatchRoomState>;
  private root: HTMLElement;
  private player: VideoPlayer | null = null;
  private isHost = false;
  private driftTimer: ReturnType<typeof setInterval> | null = null;
  private loadedVideoId = "";
  private searchNextPageToken: string | null = null;
  private searchLoading = false;

  constructor(room: Room<WatchRoomState>, root: HTMLElement) {
    this.room = room;
    this.root = root;
    this.renderShell();
    this.bindRoomMessages();
    this.bindStateListeners();
    this.bindConnectionHandlers();
    this.setConnectionStatus("connected");
  }

  private renderShell() {
    this.root.innerHTML = `
      <div class="watch-app">
        <header class="watch-header">
          <h1>Watch Together</h1>
          <span id="connection-badge" class="connection-badge connecting">Connecting…</span>
          <span id="host-badge" class="host-badge hidden">You are the host</span>
        </header>
        <div id="loading-overlay" class="loading-overlay hidden">
          <div class="loading-spinner"></div>
          <span id="loading-text">Loading video…</span>
        </div>
        <div id="status" class="status hidden"></div>
        <div class="player-wrap">
          <div id="yt-player"></div>
          <div id="player-placeholder" class="player-placeholder">
            Paste a YouTube URL below to start watching
          </div>
        </div>
        <div class="controls-bar">
          <div class="url-row">
            <input id="url-input" type="text" placeholder="Paste YouTube URL, playlist, or video ID" maxlength="500" />
            <button id="load-btn" type="button">Load</button>
            <button id="queue-btn" type="button">Add to queue</button>
            <button id="import-playlist-btn" type="button">Import playlist</button>
          </div>
          <div class="search-row">
            <input id="search-input" type="text" placeholder="Search YouTube (requires API key on server)" maxlength="100" />
            <button id="search-btn" type="button">Search</button>
          </div>
          <div class="playback-row">
            <button id="play-btn" type="button" disabled>Play</button>
            <button id="pause-btn" type="button" disabled>Pause</button>
            <button id="skip-btn" type="button" disabled>Skip</button>
            <button id="ended-btn" type="button" disabled>Video ended</button>
            <span id="video-title" class="video-title"></span>
          </div>
        </div>
        <div class="panels">
          <section class="panel panel-search">
            <h2>Search results</h2>
            <ul id="search-results" class="search-results"></ul>
            <button id="search-more-btn" type="button" class="search-more hidden">Load more</button>
          </section>
          <section class="panel">
            <h2>Queue</h2>
            <ul id="queue-list" class="queue-list"></ul>
          </section>
          <section class="panel">
            <h2>Viewers</h2>
            <ul id="members-list" class="members-list"></ul>
          </section>
        </div>
      </div>
    `;

    this.root.querySelector("#load-btn")?.addEventListener("click", () => this.handleLoad(false));
    this.root.querySelector("#queue-btn")?.addEventListener("click", () => this.handleLoad(true));
    this.root.querySelector("#import-playlist-btn")?.addEventListener("click", () => this.handlePlaylistImport());
    this.root.querySelector("#search-btn")?.addEventListener("click", () => this.handleSearch(false));
    this.root.querySelector("#search-more-btn")?.addEventListener("click", () => this.handleSearch(true));
    this.root.querySelector("#play-btn")?.addEventListener("click", () => this.hostPlay());
    this.root.querySelector("#pause-btn")?.addEventListener("click", () => this.hostPause());
    this.root.querySelector("#skip-btn")?.addEventListener("click", () => this.room.send("skipVideo", {}));
    this.root.querySelector("#ended-btn")?.addEventListener("click", () => this.room.send("videoEnded", {}));

    this.root.querySelector("#url-input")?.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") this.handleLoad(false);
    });
    this.root.querySelector("#search-input")?.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") this.handleSearch(false);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.room.send("syncRequest", {});
      }
    });
  }

  private showStatus(message: string, isError = false) {
    const el = this.root.querySelector("#status") as HTMLElement;
    el.textContent = message;
    el.classList.toggle("error", isError);
    el.classList.remove("hidden");
  }

  private clearStatus() {
    const el = this.root.querySelector("#status") as HTMLElement;
    el.classList.add("hidden");
    el.textContent = "";
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

  private setLoading(visible: boolean, text = "Loading video…") {
    const overlay = this.root.querySelector("#loading-overlay") as HTMLElement;
    const label = this.root.querySelector("#loading-text") as HTMLElement;
    label.textContent = text;
    overlay.classList.toggle("hidden", !visible);
  }

  private bindConnectionHandlers() {
    this.room.onLeave((code) => {
      this.setConnectionStatus("disconnected");
      this.showStatus(`Disconnected from room (code ${code}). Re-open the Activity to reconnect.`, true);
    });

    this.room.onError((code, message) => {
      this.setConnectionStatus("disconnected");
      this.showStatus(`Connection error (${code}): ${message ?? "Unknown error"}`, true);
    });
  }

  private setHostUI(isHost: boolean) {
    this.isHost = isHost;
    const badge = this.root.querySelector("#host-badge") as HTMLElement;
    badge.classList.toggle("hidden", !isHost);

    const disabled = !isHost;
    for (const id of ["#play-btn", "#pause-btn", "#skip-btn", "#ended-btn", "#queue-btn", "#import-playlist-btn", "#search-btn", "#load-btn"]) {
      (this.root.querySelector(id) as HTMLButtonElement).disabled = disabled;
    }
    (this.root.querySelector("#search-input") as HTMLInputElement).disabled = disabled;
  }

  private async handlePlaylistImport() {
    if (!this.isHost) return;
    const input = (this.root.querySelector("#url-input") as HTMLInputElement).value;
    const playlistId = parsePlaylistId(input);
    if (!playlistId) {
      this.showStatus("Invalid playlist URL or ID", true);
      return;
    }
    this.clearStatus();
    try {
      const result = await importYouTubePlaylist(input.trim() || playlistId);
      if (result.items.length === 0) {
        this.showStatus(result.error ?? "Playlist is empty", true);
        return;
      }
      this.room.send("addBatchToQueue", {
        items: result.items.map((v) => ({ videoId: v.videoId, title: v.title })),
      });
      this.showStatus(`Imported ${result.items.length} videos from "${result.title}"`);
      (this.root.querySelector("#url-input") as HTMLInputElement).value = "";
    } catch (e) {
      this.showStatus(e instanceof Error ? e.message : "Playlist import failed", true);
    }
  }

  private async handleSearch(loadMore: boolean) {
    if (!this.isHost || this.searchLoading) return;
    const input = this.root.querySelector("#search-input") as HTMLInputElement;
    const query = input.value.trim();
    if (!loadMore && query.length < 2) {
      this.showStatus("Enter at least 2 characters to search", true);
      return;
    }
    if (!loadMore) this.searchNextPageToken = null;

    this.searchLoading = true;
    const btn = this.root.querySelector("#search-btn") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Searching…";

    try {
      const result = await searchYouTube(query, loadMore ? this.searchNextPageToken ?? "" : "");
      this.searchNextPageToken = result.nextPageToken;
      this.renderSearchResults(result.items, loadMore);
      const moreBtn = this.root.querySelector("#search-more-btn") as HTMLButtonElement;
      moreBtn.classList.toggle("hidden", !result.nextPageToken);
      this.clearStatus();
    } catch (e) {
      this.showStatus(e instanceof Error ? e.message : "Search failed", true);
    } finally {
      this.searchLoading = false;
      btn.disabled = !this.isHost;
      btn.textContent = "Search";
    }
  }

  private renderSearchResults(items: YouTubeVideoResult[], append: boolean) {
    const list = this.root.querySelector("#search-results") as HTMLUListElement;
    if (!append) list.innerHTML = "";

    for (const video of items) {
      const li = document.createElement("li");
      li.className = "search-result-item";
      const thumb = video.thumbnail
        ? `<img src="${this.escapeAttr(video.thumbnail)}" alt="" class="search-thumb" />`
        : "";
      li.innerHTML = `
        ${thumb}
        <div class="search-meta">
          <span class="search-title">${this.escapeHtml(video.title)}</span>
          <span class="search-channel">${this.escapeHtml(video.channel)}${video.duration ? ` · ${video.duration}` : ""}</span>
        </div>
      `;
      if (this.isHost) {
        const actions = document.createElement("div");
        actions.className = "search-actions";
        const playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.textContent = "Play";
        playBtn.addEventListener("click", () => {
          this.room.send("loadVideo", { videoId: video.videoId, title: video.title });
        });
        const queueBtn = document.createElement("button");
        queueBtn.type = "button";
        queueBtn.textContent = "+ Queue";
        queueBtn.className = "search-queue-btn";
        queueBtn.addEventListener("click", () => {
          this.room.send("addToQueue", { videoId: video.videoId, title: video.title });
        });
        actions.appendChild(playBtn);
        actions.appendChild(queueBtn);
        li.appendChild(actions);
      }
      list.appendChild(li);
    }
  }

  private async handleLoad(addToQueue: boolean) {
    if (!this.isHost) return;
    const input = (this.root.querySelector("#url-input") as HTMLInputElement).value;
    const playlistId = parsePlaylistId(input);
    if (playlistId && !parseYouTubeId(input)) {
      await this.handlePlaylistImport();
      return;
    }
    const videoId = parseYouTubeId(input);
    if (!videoId) {
      this.showStatus("Invalid YouTube URL or video ID", true);
      return;
    }
    this.clearStatus();
    const title = await fetchVideoTitle(videoId);

    if (addToQueue) {
      this.room.send("addToQueue", { videoId, title });
    } else {
      this.room.send("loadVideo", { videoId, title });
    }
    (this.root.querySelector("#url-input") as HTMLInputElement).value = "";
  }

  private hostPlay() {
    if (!this.isHost || !this.player) return;
    const currentTime = this.player.getCurrentTime();
    this.player.play(currentTime);
    this.room.send("play", { currentTime });
  }

  private hostPause() {
    if (!this.isHost || !this.player) return;
    const currentTime = this.player.getCurrentTime();
    this.player.pause(currentTime);
    this.room.send("pause", { currentTime });
  }

  private bindRoomMessages() {
    this.room.onMessage("roomJoined", (data: { isHost: boolean; sync: SyncPayload }) => {
      this.setHostUI(data.isHost);
      this.refreshUI();
      this.applySync(data.sync, true);
      this.startDriftTimer();
    });

    this.room.onMessage("play", (data: { currentTime: number }) => {
      this.applyPlay(data.currentTime);
    });

    this.room.onMessage("pause", (data: { currentTime: number }) => {
      this.applyPause(data.currentTime);
    });

    this.room.onMessage("seek", (data: { currentTime: number }) => {
      this.seekTo(data.currentTime);
    });

    this.room.onMessage("setRate", (data: { rate: number; currentTime: number }) => {
      this.seekTo(data.currentTime);
      this.player?.setPlaybackRate(data.rate);
    });

    this.room.onMessage("videoChanged", (sync: SyncPayload) => {
      this.applySync(sync, true);
    });

    this.room.onMessage("sync", (sync: SyncPayload) => {
      this.applySync(sync, false);
    });

    this.room.onMessage("forceSync", (sync: SyncPayload) => {
      this.applySync(sync, true);
    });

    this.room.onMessage("hostChanged", (data: { hostSessionId: string }) => {
      const isHost = data.hostSessionId === this.room.sessionId;
      this.setHostUI(isHost);
      if (isHost) {
        this.showStatus("You are now the host");
      }
    });

    this.room.onMessage("queueEmpty", () => {
      this.showStatus("Queue is empty");
    });

    this.room.onMessage("batchQueued", (data: { count: number }) => {
      this.showStatus(`Added ${data.count} videos to queue`);
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
    }
    callbacks.onChange(this.room.state, () => {
      this.renderQueue();
      this.renderVideoTitle();
    });
  }

  private refreshUI() {
    this.renderMembers();
    this.renderQueue();
    this.renderVideoTitle();
  }

  private renderMembers() {
    const list = this.root.querySelector("#members-list") as HTMLUListElement;
    if (!list) return;
    list.innerHTML = "";
    const members = this.room.state.members;
    if (!members?.forEach) return;
    members.forEach((member, sessionId) => {
      const li = document.createElement("li");
      const isHost = sessionId === this.room.state.hostSessionId;
      const avatar = member.avatarUrl
        ? `<img src="${this.escapeAttr(member.avatarUrl)}" alt="" class="avatar" />`
        : `<span class="avatar-fallback">${this.escapeHtml(member.username.charAt(0).toUpperCase())}</span>`;
      li.innerHTML = `${avatar}<span>${this.escapeHtml(member.username)}${isHost ? " (host)" : ""}</span>`;
      list.appendChild(li);
    });
  }

  private renderQueue() {
    const list = this.root.querySelector("#queue-list") as HTMLUListElement;
    if (!list) return;
    list.innerHTML = "";
    const queue = this.room.state.queue;
    if (!queue?.forEach) return;
    queue.forEach((item: QueueItem, index: number) => {
      const li = document.createElement("li");
      const title = item.title || item.videoId;
      li.innerHTML = `<span>${index + 1}. ${this.escapeHtml(title)}</span>`;
      if (this.isHost) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Remove";
        btn.className = "queue-remove";
        btn.addEventListener("click", () => this.room.send("removeFromQueue", { index }));
        li.appendChild(btn);
      }
      list.appendChild(li);
    });
  }

  private renderVideoTitle() {
    const el = this.root.querySelector("#video-title") as HTMLElement;
    el.textContent = this.room.state.videoTitle || "";
  }

  private async ensurePlayer(videoId: string): Promise<void> {
    if (!videoId) {
      this.root.querySelector("#player-placeholder")?.classList.remove("hidden");
      return;
    }
    this.root.querySelector("#player-placeholder")?.classList.add("hidden");

    if (this.player && this.loadedVideoId === videoId) return;

    if (this.player) {
      this.player.destroy();
      this.player = null;
    }

    const container = this.root.querySelector("#yt-player") as HTMLElement;
    container.innerHTML = '<div id="yt-iframe-target"></div>';

    this.setLoading(true, "Loading video…");
    try {
      this.player = await createYouTubePlayer("yt-iframe-target", videoId, {
        onReady: () => this.setLoading(false),
      });
      this.loadedVideoId = videoId;
      this.clearStatus();
    } catch {
      this.setLoading(false);
      this.showStatus("Failed to load YouTube player. Check your connection and try again.", true);
    }
  }

  private async applySync(sync: SyncPayload, force: boolean) {
    await this.ensurePlayer(sync.videoId);
    if (!this.player || !sync.videoId) return;

    const drift = Math.abs(this.player.getCurrentTime() - sync.currentTime);
    if (force || drift > SYNC_APPLY_THRESHOLD) {
      this.seekTo(sync.currentTime);
    }

    if (sync.playbackRate) {
      this.player.setPlaybackRate(sync.playbackRate);
    }

    if (sync.isPlaying) {
      this.applyPlay(sync.currentTime);
    } else {
      this.applyPause(sync.currentTime);
    }

    this.renderVideoTitle();
  }

  private applyPlay(currentTime: number) {
    if (!this.player) return;
    this.player.play(currentTime);
  }

  private applyPause(currentTime: number) {
    if (!this.player) return;
    this.player.pause(currentTime);
  }

  private seekTo(time: number) {
    if (!this.player) return;
    this.player.seek(time);
  }

  private startDriftTimer() {
    if (this.driftTimer) clearInterval(this.driftTimer);
    this.driftTimer = setInterval(() => {
      if (this.isHost || !this.player) return;
      if (this.player.isPlaying()) {
        this.room.send("syncReport", { currentTime: this.player.getCurrentTime() });
      }
    }, DRIFT_CHECK_INTERVAL_MS);
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
    if (this.driftTimer) clearInterval(this.driftTimer);
    this.player?.destroy();
  }
}
