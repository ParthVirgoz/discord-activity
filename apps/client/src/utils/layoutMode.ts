export type WatchLayoutMode = "desktop" | "compact" | "mini";

/** Classify viewport for SyncTube layout (desktop / mobile sheets / mini video-only). */
export function detectWatchLayoutMode(width: number, height: number): WatchLayoutMode {
  // Discord pop-out / minimized activity — video only
  if (height <= 380 || (width <= 540 && height <= 540)) {
    return "mini";
  }
  if (width <= 768) {
    return "compact";
  }
  return "desktop";
}
