declare namespace YT {
  class Player {
    constructor(elementId: string, options: PlayerOptions);
  }

  interface PlayerOptions {
    videoId?: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (event: { target: import("./YouTubePlayer.js").YTPlayer }) => void;
      onStateChange?: (event: { data: number }) => void;
      onError?: (event: { data: number }) => void;
    };
  }
}
