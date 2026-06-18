import type { PlaylistMode, RoomSettings } from "@/lib/types";

export function playlistModeLabel(mode: PlaylistMode): string {
  return mode === "queue" ? "Queue" : "List";
}

export function playlistModeDescription(mode: PlaylistMode): string {
  if (mode === "queue") {
    return "Videos are removed from the list when they are played.";
  }
  return "Videos stay in the list when they are played.";
}

export function isListMode(settings: RoomSettings): boolean {
  return settings.playlistMode === "list";
}

export function pickRandomIndex(length: number, excludeIndex = -1): number {
  if (length <= 0) return -1;
  if (length === 1) return excludeIndex === 0 ? -1 : 0;
  const candidates: number[] = [];
  for (let i = 0; i < length; i++) {
    if (i !== excludeIndex) candidates.push(i);
  }
  if (candidates.length === 0) return -1;
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}
