import type { WatchMode } from "@/lib/types";

export function watchModeLabel(mode: WatchMode): string {
  return mode === "movie" ? "Movie" : "Music";
}

export function watchModeDescription(mode: WatchMode): string {
  if (mode === "movie") {
    return "Large video player for films and long-form content.";
  }
  return "Compact player with a prominent playlist for songs and listening.";
}

export function isMusicWatchMode(mode: WatchMode): boolean {
  return mode === "music";
}
