import type { RoomSettings } from "@/lib/types";

export interface RoomPermissions {
  canAddToPlaylist: boolean;
  canReorderPlaylist: boolean;
  canPlayFromQueue: boolean;
  /** Play, pause, seek, skip, speed — host, or everyone when setting is on. */
  canControlPlayback: boolean;
}

/** Client-side permission flags derived from host role + room settings. */
export function computeRoomPermissions(
  isHost: boolean,
  settings: RoomSettings
): RoomPermissions {
  return {
    canAddToPlaylist: true,
    canReorderPlaylist: isHost || settings.everyoneCanReorderPlaylist,
    canPlayFromQueue: true,
    canControlPlayback: isHost || settings.everyoneCanControlPlayback,
  };
}
