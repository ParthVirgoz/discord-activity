export type VideoSource = "youtube" | "direct";

export type QueueAfterJump = "continue" | "fifo";

export type PlaylistMode = "queue" | "list";

export type WatchMode = "music" | "movie";

/** continue = after jumping to a queue item, play the next item after it. fifo = resume from front of queue. */
export interface RoomSettings {
  /** music = compact player + queue focus; movie = large video player. */
  watchMode: WatchMode;
  /** When true, viewers can reorder, remove, clear queue, and use play-next. */
  everyoneCanReorderPlaylist: boolean;
  /** When true, viewers can play, pause, seek, skip, and change speed for everyone. */
  everyoneCanControlPlayback: boolean;
  anyoneCanBecomeHost: boolean;
  queueAfterJump: QueueAfterJump;
  /** queue = remove videos when played; list = keep videos in the playlist. */
  playlistMode: PlaylistMode;
  shuffle: boolean;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  watchMode: "music",
  everyoneCanReorderPlaylist: true,
  everyoneCanControlPlayback: false,
  anyoneCanBecomeHost: false,
  queueAfterJump: "continue",
  playlistMode: "list",
  shuffle: false,
};

export interface VideoItem {
  id: string;
  source: VideoSource;
  url?: string;
  videoId?: string;
  title: string;
  mimeType?: string;
  thumbnail?: string;
  channel?: string;
  addedBy: string;
}

export interface PlaybackSnapshot {
  currentVideo: VideoItem | null;
  currentTime: number;
  playing: boolean;
  speed: number;
}

export interface RoomMember {
  userId: string;
  username: string;
  avatarUrl?: string;
  socketId: string;
  joinedAt: number;
}

export interface RoomMeta {
  id: string;
  hostId: string;
  createdAt: number;
}

export interface RoomJoinedPayload {
  room: RoomMeta;
  members: RoomMember[];
  queue: VideoItem[];
  playback: PlaybackSnapshot;
  isHost: boolean;
  settings: RoomSettings;
  canAddToPlaylist: boolean;
  canReorderPlaylist: boolean;
  canPlayFromQueue: boolean;
  canControlPlayback: boolean;
}

export interface HostChangedPayload {
  hostId: string;
  hostUsername: string;
  members: RoomMember[];
}

export interface MembersUpdatedPayload {
  members: RoomMember[];
}

export interface VideoChangedPayload {
  video: VideoItem;
  queue: VideoItem[];
  autoplay?: boolean;
}

export interface SearchResultItem {
  videoId: string;
  title: string;
  thumbnail: string;
  duration?: string;
  channel?: string;
}

export const SYNC_INTERVAL_MS = 3000;
export const DRIFT_THRESHOLD_SEC = 0.5;

export function normalizeRoomSettings(raw: Partial<RoomSettings> & { everyoneCanEditPlaylist?: boolean }): RoomSettings {
  return {
    watchMode: raw.watchMode === "movie" ? "movie" : "music",
    everyoneCanReorderPlaylist:
      raw.everyoneCanReorderPlaylist ??
      raw.everyoneCanEditPlaylist ??
      DEFAULT_ROOM_SETTINGS.everyoneCanReorderPlaylist,
    everyoneCanControlPlayback:
      raw.everyoneCanControlPlayback ?? DEFAULT_ROOM_SETTINGS.everyoneCanControlPlayback,
    anyoneCanBecomeHost: raw.anyoneCanBecomeHost ?? DEFAULT_ROOM_SETTINGS.anyoneCanBecomeHost,
    queueAfterJump: raw.queueAfterJump ?? DEFAULT_ROOM_SETTINGS.queueAfterJump,
    playlistMode: raw.playlistMode ?? DEFAULT_ROOM_SETTINGS.playlistMode,
    shuffle: raw.shuffle ?? DEFAULT_ROOM_SETTINGS.shuffle,
  };
}
