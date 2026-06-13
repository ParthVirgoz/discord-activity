/**
 * YouTube embed via plain iframe + postMessage (no external iframe_api script).
 * Discord Activities block loading youtube.com/iframe_api, but enablejsapi=1 still
 * exposes play/pause/seek and state events through postMessage.
 */

import { buildYouTubeEmbedUrl } from "../utils/youtubeEmbed.js";

export type YtPlayerState =
  | "unstarted"
  | "ended"
  | "playing"
  | "paused"
  | "buffering"
  | "cued";

export interface VideoPlayer {
  play(startTime?: number): void;
  pause(atTime?: number): void;
  seek(time: number): void;
  load(videoId: string, startTime?: number, autoplay?: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getLastState(): YtPlayerState;
  isPlaying(): boolean;
  setPlaybackRate(_rate: number): void;
  waitForReady(): Promise<void>;
  destroy(): void;
}

export type PlayerEventHandler = {
  onReady?: () => void;
  /** Fired when YouTube player state changes (including native in-iframe controls). */
  onStateChange?: (state: YtPlayerState, currentTime: number) => void;
  /** Fired when YouTube reports a playback error (unavailable, embedding blocked, etc.). */
  onError?: (errorCode: number) => void;
};

const YT_ORIGIN = "https://www.youtube.com";
const YT_NOCOOKIE_ORIGIN = "https://www.youtube-nocookie.com";

function buildEmbedUrl(videoId: string, startSec: number, autoplay: boolean): string {
  return buildYouTubeEmbedUrl(videoId, startSec, autoplay);
}

function mapPlayerState(code: number): YtPlayerState {
  switch (code) {
    case 0:
      return "ended";
    case 1:
      return "playing";
    case 2:
      return "paused";
    case 3:
      return "buffering";
    case 5:
      return "cued";
    default:
      return "unstarted";
  }
}

export class PostMessageVideoPlayer implements VideoPlayer {
  private iframe: HTMLIFrameElement;
  private videoId = "";
  private anchorTime = 0;
  private playing = false;
  private timeAnchorAt = 0;
  private ready = false;
  private suppressEvents = 0;
  private onStateChange?: (state: YtPlayerState, currentTime: number) => void;
  private onReady?: () => void;
  private onError?: (errorCode: number) => void;
  private messageHandler: (event: MessageEvent) => void;
  private readyPromise: Promise<void> = Promise.resolve();
  private resolveReady: (() => void) | null = null;
  private durationSec = 0;
  private lastState: YtPlayerState = "unstarted";
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(container: HTMLElement, handlers: PlayerEventHandler) {
    this.onStateChange = handlers.onStateChange;
    this.onReady = handlers.onReady;
    this.onError = handlers.onError;

    this.iframe = document.createElement("iframe");
    this.iframe.id = `yt-embed-${Math.random().toString(36).slice(2, 9)}`;
    this.iframe.title = "YouTube video player";
    this.iframe.referrerPolicy = "strict-origin-when-cross-origin";
    this.iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    );
    this.iframe.allowFullscreen = true;
    this.iframe.style.cssText = "width:100%;height:100%;border:0;";
    container.appendChild(this.iframe);

    this.messageHandler = (event: MessageEvent) => this.handleMessage(event);
    window.addEventListener("message", this.messageHandler);

    this.resetReadyPromise();
    this.iframe.addEventListener("load", () => {
      this.notifyListening();
      this.subscribeToPlayerEvents();
      this.startInfoPolling();
      if (!this.ready) {
        this.ready = true;
        this.onReady?.();
      }
      this.resolveReady?.();
      this.resolveReady = null;
    });
  }

  private notifyListening() {
    if (!this.iframe.contentWindow) return;
    this.iframe.contentWindow.postMessage(
      JSON.stringify({ event: "listening", id: this.iframe.id, channel: "widget" }),
      YT_ORIGIN
    );
  }

  private startInfoPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (!this.videoId) return;
      this.postCommand("getVideoData");
      this.postCommand("getCurrentTime");
    }, 500);
  }

  private resetReadyPromise() {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  waitForReady(): Promise<void> {
    return this.readyPromise;
  }

  private handleMessage(event: MessageEvent) {
    if (event.origin !== YT_ORIGIN && event.origin !== YT_NOCOOKIE_ORIGIN) return;
    if (event.source !== this.iframe.contentWindow) return;

    let data: Record<string, unknown>;
    try {
      data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }

    if (data.event === "infoDelivery" && data.info && typeof data.info === "object") {
      const info = data.info as Record<string, unknown>;
      if (typeof info.currentTime === "number") {
        this.setReportedTime(info.currentTime);
      }
      if (typeof info.duration === "number" && info.duration > 0) {
        this.durationSec = info.duration;
      }
      if (typeof info.playerState === "number") {
        this.applyReportedState(mapPlayerState(info.playerState));
      }
    }

    if (data.event === "onStateChange" && typeof data.info === "number") {
      this.applyReportedState(mapPlayerState(data.info));
    }

    if (data.event === "onError" && typeof data.info === "number") {
      this.onError?.(data.info);
    }
  }

  private subscribeToPlayerEvents() {
    this.postCommand("addEventListener", ["onStateChange"]);
    this.postCommand("addEventListener", ["onVideoProgress"]);
    this.postCommand("addEventListener", ["onError"]);
  }

  private postCommand(func: string, args: (string | number | boolean)[] = []) {
    if (!this.iframe.contentWindow) return;
    this.iframe.contentWindow.postMessage(
      JSON.stringify({ event: "command", func, args }),
      YT_ORIGIN
    );
  }

  private setReportedTime(time: number) {
    this.anchorTime = Math.max(0, time);
    this.timeAnchorAt = Date.now();
  }

  private applyReportedState(state: YtPlayerState) {
    const wasPlaying = this.playing;
    this.lastState = state;
    if (state === "ended") {
      this.playing = false;
    } else {
      this.playing = state === "playing" || state === "buffering";
    }

    if (state === "playing") {
      this.timeAnchorAt = Date.now();
    }

    if (this.suppressEvents > 0) return;

    if (state === "ended" || state === "paused" || state === "playing") {
      this.onStateChange?.(state, this.getCurrentTime());
    } else if (wasPlaying !== this.playing) {
      this.onStateChange?.(state, this.getCurrentTime());
    }
  }

  private runSuppressed(action: () => void) {
    this.suppressEvents += 1;
    action();
    window.setTimeout(() => {
      this.suppressEvents = Math.max(0, this.suppressEvents - 1);
    }, 400);
  }

  load(videoId: string, startTime = 0, autoplay = false): void {
    this.setReportedTime(startTime);
    this.playing = autoplay;
    this.lastState = autoplay ? "playing" : "paused";
    this.durationSec = 0;

    if (videoId !== this.videoId) {
      this.videoId = videoId;
      this.ready = false;
      this.resetReadyPromise();
      this.iframe.src = buildEmbedUrl(videoId, startTime, autoplay);
      return;
    }

    this.runSuppressed(() => {
      this.postCommand("seekTo", [startTime, true]);
      if (autoplay) {
        this.postCommand("playVideo");
      } else {
        this.postCommand("pauseVideo");
      }
    });
  }

  play(startTime?: number): void {
    if (startTime !== undefined) {
      this.setReportedTime(startTime);
      this.runSuppressed(() => {
        this.postCommand("seekTo", [startTime, true]);
        this.postCommand("playVideo");
      });
    } else {
      this.runSuppressed(() => this.postCommand("playVideo"));
    }
    this.playing = true;
    this.timeAnchorAt = Date.now();
  }

  pause(atTime?: number): void {
    if (atTime !== undefined) {
      this.setReportedTime(atTime);
      this.runSuppressed(() => {
        this.postCommand("seekTo", [atTime, true]);
        this.postCommand("pauseVideo");
      });
    } else {
      this.runSuppressed(() => this.postCommand("pauseVideo"));
    }
    this.playing = false;
  }

  seek(time: number): void {
    this.setReportedTime(time);
    this.runSuppressed(() => this.postCommand("seekTo", [time, true]));
    if (this.playing) this.timeAnchorAt = Date.now();
  }

  getCurrentTime(): number {
    if (!this.playing) return this.anchorTime;
    return this.anchorTime + (Date.now() - this.timeAnchorAt) / 1000;
  }

  getDuration(): number {
    return this.durationSec;
  }

  getLastState(): YtPlayerState {
    return this.lastState;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  setPlaybackRate(): void {
    // Not supported without full IFrame API
  }

  destroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    window.removeEventListener("message", this.messageHandler);
    this.iframe.remove();
  }
}

export async function createYouTubePlayer(
  elementId: string,
  handlers: PlayerEventHandler
): Promise<VideoPlayer> {
  const container = document.getElementById(elementId);
  if (!container) throw new Error("Player container not found");

  return new PostMessageVideoPlayer(container, handlers);
}
