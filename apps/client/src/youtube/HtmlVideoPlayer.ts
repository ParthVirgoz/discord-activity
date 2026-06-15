import type { VideoPlayer, PlayerEventHandler, YtPlayerState } from "./YouTubePlayer.js";
import { getYouTubeMediaUrl } from "../utils/discordUrls.js";

const DISCORD_AUTOPLAY_RETRIES = 12;
const LOAD_TIMEOUT_MS = 60_000;
const MAX_SRC_RETRIES = 4;

export class HtmlVideoPlayer implements VideoPlayer {
  private video: HTMLVideoElement;
  private videoId = "";
  private ready = false;
  private readyPromise: Promise<void>;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((err: Error) => void) | null = null;
  private loadTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastState: YtPlayerState = "unstarted";
  private wantsPlay = false;
  private autoplayRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private seekResumeCleanup: (() => void) | null = null;
  private onStateChange?: (state: YtPlayerState, currentTime: number) => void;
  private onDurationChange?: (durationSec: number) => void;
  private onReady?: () => void;
  private onError?: (errorCode: number) => void;
  private onAutoplayBlocked?: (mode: "muted" | "blocked") => void;
  private srcRetryCount = 0;
  private playbackMuted = false;
  private mediaGeneration = 0;

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

    this.video.addEventListener("loadedmetadata", () => {
      this.markReady();
      notifyDuration();
    });

    this.video.addEventListener("loadeddata", () => {
      this.markReady();
    });

    this.video.addEventListener("durationchange", notifyDuration);

    this.video.addEventListener("playing", () => {
      this.lastState = "playing";
      this.clearAutoplayRetry();
      this.clearSeekResume();
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

    this.video.addEventListener("error", () => {
      if (this.retrySourceLoad()) return;
      this.failReady(new Error("Video failed to load"));
      this.onError?.(150);
    });
  }

  private createReadyPromise(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  private resetReadyPromise(): void {
    this.clearLoadTimeout();
    this.readyPromise = this.createReadyPromise();
  }

  private markReady(): void {
    this.clearLoadTimeout();
    this.srcRetryCount = 0;
    if (!this.ready) {
      this.ready = true;
      this.onReady?.();
    }
    this.resolveReady?.();
    this.resolveReady = null;
    this.rejectReady = null;
  }

  private failReady(err: Error): void {
    this.clearLoadTimeout();
    this.rejectReady?.(err);
    this.resolveReady = null;
    this.rejectReady = null;
  }

  private clearLoadTimeout(): void {
    if (this.loadTimeout) {
      clearTimeout(this.loadTimeout);
      this.loadTimeout = null;
    }
  }

  private scheduleLoadTimeout(): void {
    this.clearLoadTimeout();
    this.loadTimeout = setTimeout(() => {
      this.loadTimeout = null;
      if (this.ready) return;
      if (this.retrySourceLoad()) return;
      this.failReady(new Error("Video load timed out"));
      this.onError?.(150);
    }, LOAD_TIMEOUT_MS);
  }

  /** Retry stream fetch before reporting failure (Piped can be slow in Discord). */
  private retrySourceLoad(): boolean {
    if (!this.videoId || this.srcRetryCount >= MAX_SRC_RETRIES) return false;
    this.srcRetryCount += 1;
    this.mediaGeneration += 1;
    this.ready = false;
    this.resetReadyPromise();
    const delay = 1500 * this.srcRetryCount;
    setTimeout(() => {
      if (!this.videoId) return;
      this.video.src = getYouTubeMediaUrl(this.videoId, this.mediaGeneration);
      this.video.load();
      this.scheduleLoadTimeout();
    }, delay);
    return true;
  }

  private assignMediaSource(videoId: string): void {
    this.video.src = getYouTubeMediaUrl(videoId, this.mediaGeneration);
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

  /** Discord often blocks the first autoplay attempt — retry, then try muted play. */
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

  /** Muted autoplay is allowed in most embedded browsers — keeps sync until user taps. */
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

  /** Keep playing through forward seeks — browser pauses while fetching new ranges. */
  private resumeAfterSeek(): void {
    this.clearSeekResume();
    this.tryResumePlayback();

    const onSeeked = () => {
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
    if (startTime !== undefined) {
      const drift = Math.abs(this.video.currentTime - startTime);
      if (drift > 0.05) this.setMediaTime(startTime);
    }
    this.wantsPlay = true;
    this.startPlayback();
  }

  private setMediaTime(time: number): void {
    const forward = time > this.video.currentTime + 0.5;
    if (forward && typeof this.video.fastSeek === "function") {
      try {
        this.video.fastSeek(time);
        return;
      } catch {
        /* fall through */
      }
    }
    this.video.currentTime = time;
  }

  waitForReady(): Promise<void> {
    return this.readyPromise;
  }

  load(videoId: string, startTime = 0, autoplay = false): void {
    this.wantsPlay = autoplay;

    if (videoId !== this.videoId) {
      this.videoId = videoId;
      this.ready = false;
      this.srcRetryCount = 0;
      this.resetReadyPromise();
      this.lastState = "unstarted";
      this.assignMediaSource(videoId);
      this.video.load();
      this.scheduleLoadTimeout();
    }

    const applyStart = () => {
      if (startTime > 0 && Number.isFinite(this.video.duration)) {
        this.setMediaTime(Math.min(startTime, this.video.duration));
      } else if (startTime > 0) {
        this.setMediaTime(startTime);
      }
      if (autoplay) this.tryPlay();
    };

    if (this.video.readyState >= 1) {
      applyStart();
    } else {
      this.video.addEventListener("loadedmetadata", applyStart, { once: true });
    }
  }

  play(startTime?: number): void {
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
    if (atTime !== undefined) {
      const drift = Math.abs(this.video.currentTime - atTime);
      if (drift > 0.05) this.setMediaTime(atTime);
    }
    this.video.pause();
  }

  seek(time: number, keepPlaying?: boolean): void {
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
    this.clearLoadTimeout();
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
  }
}
