declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady: () => void;
  }
}

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  loadVideoById(videoId: string, startSeconds?: number): void;
  destroy(): void;
}

const YT_LOADED = new Promise<void>((resolve) => {
  if (window.YT?.Player) {
    resolve();
    return;
  }
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    prev?.();
    resolve();
  };
  if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }
});

export const YT_PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

export type PlayerEventHandler = {
  onReady?: () => void;
  onStateChange?: (state: number) => void;
  onError?: (code: number) => void;
};

export async function createYouTubePlayer(
  elementId: string,
  videoId: string,
  handlers: PlayerEventHandler
): Promise<YTPlayer> {
  await YT_LOADED;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) reject(new Error("YouTube player load timeout"));
    }, 15000);

    new window.YT.Player(elementId, {
      videoId: videoId || undefined,
      playerVars: {
        autoplay: 0,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: (event: { target: YTPlayer }) => {
          settled = true;
          clearTimeout(timeout);
          handlers.onReady?.();
          resolve(event.target);
        },
        onStateChange: (event: { data: number }) => {
          handlers.onStateChange?.(event.data);
        },
        onError: (event: { data: number }) => {
          handlers.onError?.(event.data);
        },
      },
    });
  });
}
