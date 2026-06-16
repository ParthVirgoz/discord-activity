import type { VideoPlayer, PlayerEventHandler, YtPlayerState } from "./YouTubePlayer.js";
import { getYouTubeMediaUrl } from "../utils/discordUrls.js";

const DISCORD_AUTOPLAY_RETRIES = 12;
const STREAM_READY_TIMEOUT_MS = 90_000;
const SEEK_STALL_MS = 12_000;

function waitForMediaEvent(
  video: HTMLVideoElement,
  event: keyof HTMLMediaElementEventMap,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (event === "canplay" && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      resolve();
      return;
    }

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
  private prepareTask: Promise<void> | null = null;
  private prepareGeneration = 0;
  private prepareGenerationForErrors = 0;
  private pendingStartTime = 0;

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
      if (this.wantsPlay) {
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
      if (this.prepareGenerationForErrors !== this.prepareGeneration) return;
      void this.handleMediaError();
    });
  }

  private setStreamSource(videoId: string): void {
    this.video.src = getYouTubeMediaUrl(videoId, this.mediaGeneration);
  }

  /** Fast start — ready as soon as the browser can begin playback (not full download). */
  private async waitForStreamReady(): Promise<void> {
    await waitForMediaEvent(this.video, "canplay", STREAM_READY_TIMEOUT_MS);
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

  private async runPrepare(
    videoId: string,
    startTime: number,
    generation: number
  ): Promise<void> {
    this.pendingStartTime = startTime;
    this.wantsPlay = false;
    this.ready = false;
    this.resetReadyPromise();
    this.lastState = "unstarted";
    this.clearAutoplayRetry();
    this.clearSeekResume();
    this.clearSeekStallTimer();
    this.video.pause();
    this.prepareGenerationForErrors = generation;

    this.setStreamSource(videoId);
    this.video.load();

    await this.waitForStreamReady();
    if (generation !== this.prepareGeneration) return;

    if (startTime > 0) {
      const capped =
        Number.isFinite(this.video.duration) && this.video.duration > 0
          ? Math.min(startTime, this.video.duration)
          : startTime;
      this.video.currentTime = capped;
    }

    this.video.pause();
    this.wantsPlay = false;
    this.markReady();
  }

  private startPrepare(videoId: string, startTime: number, force: boolean): void {
    const sameVideo = videoId === this.videoId;
    if (!sameVideo || force) {
      this.videoId = videoId;
      if (!sameVideo) {
        this.mediaGeneration = 0;
      }
    }

    const generation = ++this.prepareGeneration;
    this.prepareTask = this.runPrepare(videoId, startTime, generation)
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

  isReady(): boolean {
    return this.ready;
  }

  load(videoId: string, startTime = 0, _autoplay = false): void {
    this.wantsPlay = false;
    if (videoId === this.videoId && this.ready) {
      if (startTime > 0) this.setMediaTime(startTime);
      return;
    }
    const force = videoId === this.videoId && !this.ready;
    this.startPrepare(videoId, startTime, force);
  }

  reload(): Promise<void> {
    if (!this.videoId) return Promise.resolve();
    this.mediaGeneration += 1;
    this.ready = false;
    this.wantsPlay = false;
    this.resetReadyPromise();
    this.startPrepare(this.videoId, this.pendingStartTime, true);
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

    this.clearSeekStallTimer();
    this.seekStallTimer = setTimeout(() => {
      this.seekStallTimer = null;
      if (!this.wantsPlay || this.isPlaying()) return;
      void this.reload().then(() => {
        if (this.wantsPlay) this.tryPlay();
      });
    }, SEEK_STALL_MS);
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
    if (!this.ready) return;
    if (startTime !== undefined) {
      const drift = Math.abs(this.video.currentTime - startTime);
      if (drift > 0.05) this.setMediaTime(startTime);
    }
    this.tryPlay(startTime);
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
    this.prepareTask = null;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
  }
}
