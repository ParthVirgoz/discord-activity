/**
 * Discord Activities block external scripts (YouTube IFrame API).
 * This player uses a plain <iframe> embed — allowed by Discord's CSP.
 * Sync works by updating embed URL (start= & autoplay=).
 */

export interface VideoPlayer {
  play(startTime?: number): void;
  pause(atTime?: number): void;
  seek(time: number): void;
  load(videoId: string, startTime?: number, autoplay?: boolean): void;
  getCurrentTime(): number;
  isPlaying(): boolean;
  setPlaybackRate(_rate: number): void;
  destroy(): void;
}

function buildEmbedUrl(videoId: string, startSec: number, autoplay: boolean): string {
  const params = new URLSearchParams({
    start: String(Math.max(0, Math.floor(startSec))),
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });
  if (autoplay) params.set("autoplay", "1");
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`;
}

export class IframeVideoPlayer implements VideoPlayer {
  private iframe: HTMLIFrameElement;
  private videoId = "";
  private anchorTime = 0;
  private playing = false;
  private playStartedAt = 0;

  constructor(container: HTMLElement) {
    this.iframe = document.createElement("iframe");
    this.iframe.title = "YouTube video player";
    this.iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    );
    this.iframe.allowFullscreen = true;
    this.iframe.style.cssText = "width:100%;height:100%;border:0;";
    container.appendChild(this.iframe);
  }

  load(videoId: string, startTime = 0, autoplay = false): void {
    this.videoId = videoId;
    this.anchorTime = startTime;
    this.playing = autoplay;
    if (autoplay) this.playStartedAt = Date.now();
    this.iframe.src = buildEmbedUrl(videoId, startTime, autoplay);
  }

  play(startTime?: number): void {
    if (startTime !== undefined) this.anchorTime = startTime;
    this.playing = true;
    this.playStartedAt = Date.now();
    if (this.videoId) {
      this.iframe.src = buildEmbedUrl(this.videoId, this.anchorTime, true);
    }
  }

  pause(atTime?: number): void {
    this.anchorTime = atTime ?? this.getCurrentTime();
    this.playing = false;
    if (this.videoId) {
      this.iframe.src = buildEmbedUrl(this.videoId, this.anchorTime, false);
    }
  }

  seek(time: number): void {
    this.anchorTime = time;
    if (this.videoId) {
      this.iframe.src = buildEmbedUrl(this.videoId, time, this.playing);
      if (this.playing) this.playStartedAt = Date.now();
    }
  }

  getCurrentTime(): number {
    if (!this.playing) return this.anchorTime;
    return this.anchorTime + (Date.now() - this.playStartedAt) / 1000;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  setPlaybackRate(): void {
    // Playback rate not supported without YouTube IFrame API (blocked in Discord)
  }

  destroy(): void {
    this.iframe.remove();
  }
}

export type PlayerEventHandler = {
  onReady?: () => void;
};

export async function createYouTubePlayer(
  elementId: string,
  videoId: string,
  handlers: PlayerEventHandler
): Promise<VideoPlayer> {
  const container = document.getElementById(elementId);
  if (!container) throw new Error("Player container not found");

  const player = new IframeVideoPlayer(container);
  if (videoId) player.load(videoId, 0, false);
  handlers.onReady?.();
  return player;
}
