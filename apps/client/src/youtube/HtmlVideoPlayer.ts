import type { VideoPlayer, PlayerEventHandler, YtPlayerState } from "./YouTubePlayer.js";
import { getYouTubeMediaUrl } from "../utils/discordUrls.js";

const DISCORD_AUTOPLAY_RETRIES = 12;
const BUFFER_TIMEOUT_MS = 180_000;
const SEEK_STALL_MS = 12_000;
/** Buffer entire MP4 locally so seeks don't re-hit the proxy (max ~100 MB). */
const MAX_BLOB_BYTES = 100 * 1024 * 1024;

function waitForMediaEvent(
  video: HTMLVideoElement,
  event: keyof HTMLMediaElementEventMap,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      video.removeEventListener(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const onEvent = () => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      resolve();
    };

    video.addEventListener(event, onEvent, { once: true });
  });
}

export class HtmlVideoPlayer implements VideoPlayer {
  private video: HTMLVideoElement;
  private videoId = "";
  private ready = false;
  private readyPromise: Promise<void>;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((err: Error) => void) | null = null;
  private lastState: YtPlayerState = "unstarted";
  private wantsPlay = false;
  private autoplayRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private seekResumeCleanup: (() => void) | null = null;
  private seekStallTimer: ReturnType<typeof setTimeout> | null = null;
  private onStateChange?: (state: YtPlayerState, currentTime: number) => void;
  private onDurationChange?: (durationSec: number) => void;
  private onReady?: () => void;
  private onError?: (errorCode: number) => void;
  private onAutoplayBlocked?: (mode: "muted" | "blocked") => void;
  private mediaGeneration = 0;
  private playbackMuted = false;
  private blobUrl: string | null = null;
  private useStreamingSrc = false;
  private prepareTask: Promise<void> | null = null;
  private prepareAbort: AbortController | null = null;
  private prepareGeneration = 0;
  private pendingStartTime = 0;
  private pendingAutoplay = false;

  constructor(container: HTMLElement, handlers: PlayerEventHandler) {
    this.onStateChange = handlers.onStateChange;
    this.onDurationChange = handlers.onDurationChange;
    this.onReady = handlers.onReady;
    this.onError = handlers.onError;
    this.onAutoplayBlocked = handlers.onAutoplayBlocked;

    this.video = document.createElement("video");
    this.video.setAttribute("playsinline", "");
    this.video.setAttribute("webkit-playsinline", "");
    this.video.crossOrigin = "anonymous";
    this.video.controls = false;
    this.video.preload = "auto";
    this.video.style.cssText = "width:100%;height:100%;background:#000;object-fit:contain;";
    container.appendChild(this.video);

    this.readyPromise = this.createReadyPromise();

    const notifyDuration = () => {
      const duration = this.getDuration();
      if (duration > 0) this.onDurationChange?.(duration);
    };

    this.video.addEventListener("loadedmetadata", notifyDuration);
    this.video.addEventListener("durationchange", notifyDuration);

    this.video.addEventListener("playing", () => {
      this.lastState = "playing";
      this.clearAutoplayRetry();
      this.clearSeekResume();
      this.clearSeekStallTimer();
      this.onStateChange?.("playing", this.getCurrentTime());
    });

    this.video.addEventListener("pause", () => {
      if (this.video.ended) return;
      this.lastState = "paused";
      this.onStateChange?.("paused", this.getCurrentTime());
    });

    this.video.addEventListener("ended", () => {
      this.lastState = "ended";
      this.wantsPlay = false;
      this.onStateChange?.("ended", this.getCurrentTime());
    });

    this.video.addEventListener("waiting", () => {
      this.lastState = "buffering";
      this.onStateChange?.("buffering", this.getCurrentTime());
      if (this.wantsPlay && !this.useStreamingSrc) {
        window.setTimeout(() => this.tryResumePlayback(), 250);
      }
    });

    this.video.addEventListener("stalled", () => {
      if (this.wantsPlay) {
        window.setTimeout(() => this.tryResumePlayback(), 500);
      }
    });

    this.video.addEventListener("seeking", () => {
      this.lastState = "buffering";
    });

    this.video.addEventListener("seeked", () => {
      this.clearSeekStallTimer();
    });

    this.video.addEventListener("error", () => {
      void this.handleMediaError();
    });
  }

  private createReadyPromise(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  private resetReadyPromise(): void {
    this.readyPromise = this.createReadyPromise();
  }

  private markReady(): void {
    if (!this.ready) {
      this.ready = true;
      this.onReady?.();
    }
    this.resolveReady?.();
    this.resolveReady = null;
    this.rejectReady = null;
  }

  private failReady(err: Error): void {
    this.rejectReady?.(err);
    this.resolveReady = null;
    this.rejectReady = null;
  }

  private revokeBlob(): void {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  private clearAutoplayRetry(): void {
    if (this.autoplayRetryTimer) {
      clearTimeout(this.autoplayRetryTimer);
      this.autoplayRetryTimer = null;
    }
  }

  private clearSeekResume(): void {
    this.seekResumeCleanup?.();
    this.seekResumeCleanup = null;
  }

  private clearSeekStallTimer(): void {
    if (this.seekStallTimer) {
      clearTimeout(this.seekStallTimer);
      this.seekStallTimer = null;
    }
  }

  private async handleMediaError(): Promise<void> {
    if (this.mediaGeneration < 4) {
      this.mediaGeneration += 1;
      try {
        await this.reload();
        return;
      } catch {
        /* fall through */
      }
    }
    this.failReady(new Error("Video failed to load"));
    this.onError?.(150);
  }

  /** Download the full stream once — local blob makes seeks instant and reliable. */
  private async bufferFullVideo(videoId: string, signal: AbortSignal): Promise<void> {
    const url = getYouTubeMediaUrl(videoId, this.mediaGeneration);
    const res = await fetch(url, { signal, credentials: "same-origin" });
      if (!res.ok) {
        throw new Error(`Media fetch failed (${res.status})`);
      }

      const contentLength = res.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_BLOB_BYTES) {
        this.useStreamingSrc = true;
        this.revokeBlob();
        this.video.src = url;
        return;
      }

      if (!res.body) {
        throw new Error("Empty media body");
      }

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > MAX_BLOB_BYTES) {
          this.useStreamingSrc = true;
          this.revokeBlob();
          this.video.src = url;
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          return;
        }
        chunks.push(value);
      }

      const blob = new Blob(chunks as BlobPart[], {
        type: res.headers.get("content-type")?.includes("mp4") ? "video/mp4" : "video/mp4",
      });
      this.useStreamingSrc = false;
      this.revokeBlob();
      this.blobUrl = URL.createObjectURL(blob);
      this.video.src = this.blobUrl;
  }

  private async runPrepare(
    videoId: string,
    startTime: number,
    autoplay: boolean,
    generation: number
  ): Promise<void> {
    this.pendingStartTime = startTime;
    this.pendingAutoplay = autoplay;
    this.ready = false;
    this.resetReadyPromise();
    this.lastState = "unstarted";
    this.clearAutoplayRetry();
    this.clearSeekResume();
    this.clearSeekStallTimer();

    const abort = new AbortController();
    this.prepareAbort?.abort();
    this.prepareAbort = abort;
    const bufferTimeout = setTimeout(() => abort.abort(), BUFFER_TIMEOUT_MS);

    try {
      await this.bufferFullVideo(videoId, abort.signal);
      if (generation !== this.prepareGeneration) return;

      this.video.load();
      await waitForMediaEvent(this.video, "canplaythrough", BUFFER_TIMEOUT_MS);
      if (generation !== this.prepareGeneration) return;

      if (startTime > 0) {
        const capped =
          Number.isFinite(this.video.duration) && this.video.duration > 0
            ? Math.min(startTime, this.video.duration)
            : startTime;
        this.video.currentTime = capped;
      }

      this.markReady();

      if (autoplay) {
        this.tryPlay();
      }
    } catch (err) {
      if (generation !== this.prepareGeneration) return;
      throw err;
    } finally {
      clearTimeout(bufferTimeout);
      if (this.prepareAbort === abort) {
        this.prepareAbort = null;
      }
    }
  }

  private startPrepare(videoId: string, startTime: number, autoplay: boolean, force: boolean): void {
    const sameVideo = videoId === this.videoId;
    if (!sameVideo || force) {
      this.videoId = videoId;
      if (!sameVideo) {
        this.mediaGeneration = 0;
      }
    }

    const generation = ++this.prepareGeneration;
    this.prepareTask = this.runPrepare(videoId, startTime, autoplay, generation)
      .catch((err) => {
        if (generation !== this.prepareGeneration) return;
        this.ready = false;
        this.failReady(err instanceof Error ? err : new Error(String(err)));
        throw err;
      })
      .finally(() => {
        if (generation === this.prepareGeneration) {
          this.prepareTask = null;
        }
      });
  }

  waitForReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.prepareTask) return this.prepareTask;
    return this.readyPromise;
  }

  load(videoId: string, startTime = 0, autoplay = false): void {
    this.wantsPlay = autoplay;
    if (videoId === this.videoId && this.ready) {
      if (startTime > 0) this.setMediaTime(startTime);
      if (autoplay) this.tryPlay(startTime);
      return;
    }
    const force = videoId === this.videoId && !this.ready;
    this.startPrepare(videoId, startTime, autoplay, force);
  }

  /** Force a fresh download after errors or broken seek state. */
  reload(): Promise<void> {
    if (!this.videoId) return Promise.resolve();
    this.mediaGeneration += 1;
    this.ready = false;
    this.resetReadyPromise();
    this.startPrepare(this.videoId, this.pendingStartTime, this.wantsPlay, true);
    return this.waitForReady();
  }

  private scheduleAutoplayKick(attempt = 0): void {
    this.clearAutoplayRetry();
    if (!this.wantsPlay || this.isPlaying()) return;

    if (attempt >= DISCORD_AUTOPLAY_RETRIES) {
      void this.tryMutedAutoplay();
      return;
    }

    void this.video.play().catch(() => {
      /* retry */
    });
    this.autoplayRetryTimer = setTimeout(() => {
      this.scheduleAutoplayKick(attempt + 1);
    }, 400);
  }

  private async tryMutedAutoplay(): Promise<void> {
    if (!this.wantsPlay || this.isPlaying()) return;

    const restoreMuted = this.video.muted;
    this.video.muted = true;
    try {
      await this.video.play();
      this.playbackMuted = true;
      this.onAutoplayBlocked?.("muted");
      return;
    } catch {
      this.video.muted = restoreMuted;
    }

    this.onAutoplayBlocked?.("blocked");
  }

  private tryResumePlayback(): void {
    if (!this.wantsPlay || this.isPlaying()) return;
    void this.video.play().catch(() => {
      this.scheduleAutoplayKick();
    });
  }

  private resumeAfterSeek(): void {
    this.clearSeekResume();
    this.tryResumePlayback();

    const onSeeked = () => {
      this.clearSeekStallTimer();
      this.tryResumePlayback();
      if (!this.isPlaying() && this.wantsPlay) {
        this.video.addEventListener("canplay", onCanplay, { once: true });
      }
    };
    const onCanplay = () => {
      this.tryResumePlayback();
    };

    this.video.addEventListener("seeked", onSeeked, { once: true });
    this.video.addEventListener("canplay", onCanplay, { once: true });
    this.seekResumeCleanup = () => {
      this.video.removeEventListener("seeked", onSeeked);
      this.video.removeEventListener("canplay", onCanplay);
    };

    if (this.useStreamingSrc) {
      this.clearSeekStallTimer();
      this.seekStallTimer = setTimeout(() => {
        this.seekStallTimer = null;
        if (!this.wantsPlay || this.isPlaying()) return;
        void this.reload().then(() => {
          if (this.wantsPlay) this.tryPlay();
        });
      }, SEEK_STALL_MS);
    }
  }

  private startPlayback(): void {
    const playNow = () => {
      void this.video.play().catch(() => {
        this.scheduleAutoplayKick();
      });
    };

    if (this.video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      playNow();
    } else {
      this.video.addEventListener("canplay", playNow, { once: true });
    }
  }

  private tryPlay(startTime?: number): void {
    if (!this.ready) return;
    if (startTime !== undefined) {
      const drift = Math.abs(this.video.currentTime - startTime);
      if (drift > 0.05) this.setMediaTime(startTime);
    }
    this.wantsPlay = true;
    this.startPlayback();
  }

  private setMediaTime(time: number): void {
    if (!Number.isFinite(time) || time < 0) return;
    const capped =
      Number.isFinite(this.video.duration) && this.video.duration > 0
        ? Math.min(time, this.video.duration)
        : time;
    this.video.currentTime = capped;
  }

  play(startTime?: number): void {
    if (!this.ready) {
      this.wantsPlay = true;
      void this.waitForReady().then(() => this.play(startTime));
      return;
    }
    if (startTime !== undefined) {
      const drift = Math.abs(this.video.currentTime - startTime);
      if (drift > 0.05) this.setMediaTime(startTime);
    }
    this.tryPlay();
  }

  pause(atTime?: number): void {
    this.wantsPlay = false;
    this.playbackMuted = false;
    this.clearAutoplayRetry();
    this.clearSeekResume();
    this.clearSeekStallTimer();
    if (atTime !== undefined) {
      const drift = Math.abs(this.video.currentTime - atTime);
      if (drift > 0.05) this.setMediaTime(atTime);
    }
    this.video.pause();
  }

  seek(time: number, keepPlaying?: boolean): void {
    if (!this.ready) return;
    if (Math.abs(this.video.currentTime - time) <= 0.05) return;

    const resume = keepPlaying ?? (this.wantsPlay || this.isPlaying());
    this.wantsPlay = resume;
    this.setMediaTime(time);

    if (resume) {
      this.resumeAfterSeek();
    }
  }

  getCurrentTime(): number {
    return this.video.currentTime || 0;
  }

  getDuration(): number {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }

  getLastState(): YtPlayerState {
    return this.lastState;
  }

  isPlaying(): boolean {
    return !this.video.paused && !this.video.ended;
  }

  isPlaybackMuted(): boolean {
    return this.playbackMuted && this.video.muted;
  }

  isBuffered(): boolean {
    return this.ready && !this.useStreamingSrc && !!this.blobUrl;
  }

  unlockPlayback(): void {
    this.wantsPlay = true;
    this.playbackMuted = false;
    this.video.muted = false;
    const time = this.getCurrentTime();
    if (time > 0) this.setMediaTime(time);
    void this.video.play().catch(() => {
      this.scheduleAutoplayKick();
    });
  }

  setPlaybackRate(rate: number): void {
    this.video.playbackRate = rate;
  }

  destroy(): void {
    this.clearAutoplayRetry();
    this.clearSeekResume();
    this.clearSeekStallTimer();
    this.prepareGeneration += 1;
    this.prepareAbort?.abort();
    this.prepareAbort = null;
    this.prepareTask = null;
    this.video.pause();
    this.revokeBlob();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
  }
}
