import { customAlphabet } from "nanoid";
import { nanoid } from "nanoid";
import type { PlaybackSnapshot, RoomMeta, RoomMember, RoomSettings, VideoItem } from "@/lib/types";
import { DEFAULT_ROOM_SETTINGS, normalizeRoomSettings } from "@/lib/types";
import { isListMode, pickRandomIndex } from "@/lib/playlist";

const MAX_QUEUE = 50;
const ROOM_WORDS = [
  "starlight",
  "moonlit",
  "cosmic",
  "neon",
  "azure",
  "crystal",
  "sonic",
  "velocity",
  "ember",
  "frost",
  "pulse",
  "orbit",
  "prism",
  "nova",
  "echo",
];

const suffix = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 2);

function generateRoomId(): string {
  const word = ROOM_WORDS[Math.floor(Math.random() * ROOM_WORDS.length)];
  const num = Math.floor(Math.random() * 10);
  return `${word}${num}${suffix()}`;
}

interface PlaybackState {
  currentVideo: VideoItem | null;
  currentTime: number;
  playing: boolean;
  speed: number;
  lastUpdated: number;
  /** One-shot rule for the next auto-advance after a manual queue jump. */
  nextMode: "continue" | "resume_front" | null;
  /** Queue index to play when nextMode is continue. */
  nextQueueIndex: number;
}

interface RoomRuntime {
  meta: RoomMeta;
  settings: RoomSettings;
  queue: VideoItem[];
  playback: PlaybackState;
  members: Map<string, RoomMember>;
}

/** Shared across Next.js API routes and the custom Socket.IO server (avoid duplicate Maps). */
const globalStore = globalThis as typeof globalThis & {
  __synctubeRooms?: Map<string, RoomRuntime>;
};

if (!globalStore.__synctubeRooms) {
  globalStore.__synctubeRooms = new Map<string, RoomRuntime>();
}

const rooms = globalStore.__synctubeRooms;

function snapshotPlayback(state: PlaybackState): PlaybackSnapshot {
  const elapsed = (Date.now() - state.lastUpdated) / 1000;
  let currentTime = state.currentTime;
  if (state.playing) {
    currentTime += elapsed * state.speed;
  }
  return {
    currentVideo: state.currentVideo,
    currentTime: Math.round(currentTime * 1000) / 1000,
    playing: state.playing,
    speed: state.speed,
  };
}

export function createRoom(hostId: string): RoomMeta {
  let id = generateRoomId();
  while (rooms.has(id)) id = generateRoomId();
  return ensureRoom(id, hostId);
}

/** Discord voice channel id — do not lowercase numeric snowflakes. */
export function ensureRoom(roomId: string, hostId: string): RoomMeta {
  const id = roomId.trim();
  const existing = rooms.get(id);
  if (existing) return existing.meta;

  const meta: RoomMeta = { id, hostId, createdAt: Date.now() };
  rooms.set(id, {
    meta,
    settings: { ...DEFAULT_ROOM_SETTINGS },
    queue: [],
    playback: {
      currentVideo: null,
      currentTime: 0,
      playing: false,
      speed: 1,
      lastUpdated: Date.now(),
      nextMode: null,
      nextQueueIndex: 0,
    },
    members: new Map(),
  });
  return meta;
}

export function roomExists(roomId: string): boolean {
  return rooms.has(roomId.trim());
}

export function getRoom(roomId: string): RoomRuntime | null {
  return rooms.get(roomId.trim()) ?? null;
}

export function deleteRoom(roomId: string): void {
  rooms.delete(roomId.trim());
}

export function isHost(roomId: string, userId: string): boolean {
  return getRoom(roomId)?.meta.hostId === userId;
}

export function getSettings(roomId: string): RoomSettings {
  const room = getRoom(roomId);
  if (!room) return { ...DEFAULT_ROOM_SETTINGS };
  if (!room.settings) room.settings = { ...DEFAULT_ROOM_SETTINGS };
  room.settings = normalizeRoomSettings(room.settings);
  return room.settings;
}

export function canAddToPlaylist(_roomId: string, _userId: string): boolean {
  return true;
}

export function canReorderPlaylist(roomId: string, userId: string): boolean {
  if (isHost(roomId, userId)) return true;
  return getSettings(roomId).everyoneCanReorderPlaylist;
}

export function canPlayFromQueue(_roomId: string, _userId: string): boolean {
  return true;
}

/** Host, or everyone when everyoneCanControlPlayback is enabled. */
export function canControlPlayback(roomId: string, userId: string): boolean {
  if (isHost(roomId, userId)) return true;
  return getSettings(roomId).everyoneCanControlPlayback;
}

export function getMemberPermissions(roomId: string, userId: string) {
  const host = isHost(roomId, userId);
  const settings = getSettings(roomId);
  return {
    isHost: host,
    canAddToPlaylist: canAddToPlaylist(roomId, userId),
    canReorderPlaylist: canReorderPlaylist(roomId, userId),
    canPlayFromQueue: canPlayFromQueue(roomId, userId),
    canControlPlayback: canControlPlayback(roomId, userId),
  };
}

/** @deprecated use canReorderPlaylist */
export function canEditPlaylist(roomId: string, userId: string): boolean {
  return canReorderPlaylist(roomId, userId);
}

export function claimHost(roomId: string, userId: string): boolean {
  const room = getRoom(roomId);
  if (!room || !room.settings.anyoneCanBecomeHost) return false;
  if (room.meta.hostId === userId) return false;
  const member = [...room.members.values()].find((m) => m.userId === userId);
  if (!member) return false;
  room.meta.hostId = userId;
  return true;
}

export function updateSettings(
  roomId: string,
  hostUserId: string,
  patch: Partial<RoomSettings>
): RoomSettings | null {
  const room = getRoom(roomId);
  if (!room || room.meta.hostId !== hostUserId) return null;
  room.settings = normalizeRoomSettings({ ...room.settings, ...patch });
  return { ...room.settings };
}

function oldestMember(room: RoomRuntime): RoomMember | undefined {
  return [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
}

/** If the current host is not connected, assign the next participant (oldest remaining). */
export function reconcileHost(roomId: string): string | null {
  const room = getRoom(roomId);
  if (!room || room.members.size === 0) return null;
  const connected = new Set([...room.members.values()].map((m) => m.userId));
  if (connected.has(room.meta.hostId)) return null;
  const next = oldestMember(room);
  if (next) {
    room.meta.hostId = next.userId;
    return next.userId;
  }
  return null;
}

export function transferHostIfNeeded(roomId: string, leftUserId: string): string | null {
  const room = getRoom(roomId);
  if (!room || room.meta.hostId !== leftUserId) return null;
  const remaining = [...room.members.values()];
  if (remaining.length === 0) return null;
  // Next host: oldest remaining participant (2nd person who joined, etc.)
  const next = oldestMember(room);
  if (next) {
    room.meta.hostId = next.userId;
    return next.userId;
  }
  return null;
}

export function transferHost(roomId: string, fromUserId: string, toUserId: string): boolean {
  const room = getRoom(roomId);
  if (!room || room.meta.hostId !== fromUserId) return false;
  const target = [...room.members.values()].find((m) => m.userId === toUserId);
  if (!target) return false;
  room.meta.hostId = toUserId;
  return true;
}

export function updateMemberUsername(
  roomId: string,
  socketId: string,
  username: string
): RoomMember[] | null {
  const room = getRoom(roomId);
  if (!room) return null;
  const member = room.members.get(socketId);
  if (!member) return null;
  member.username = username.trim().slice(0, 32) || "Guest";
  room.members.set(socketId, member);
  return listMembers(roomId);
}

export function getHostId(roomId: string): string {
  return getRoom(roomId)?.meta.hostId ?? "";
}

export function addMember(roomId: string, member: RoomMember): RoomMember[] {
  const room = getRoom(roomId);
  if (!room) return [];
  for (const [socketId, m] of room.members) {
    if (m.userId === member.userId && socketId !== member.socketId) {
      room.members.delete(socketId);
    }
  }
  room.members.set(member.socketId, member);
  return listMembers(roomId);
}

export function removeMember(
  roomId: string,
  socketId: string
): { members: RoomMember[]; hostChanged: boolean; newHostId: string | null } {
  const room = getRoom(roomId);
  if (!room) return { members: [], hostChanged: false, newHostId: null };
  const member = room.members.get(socketId);
  const oldHostId = room.meta.hostId;
  if (member) {
    room.members.delete(socketId);
    const newHostId = transferHostIfNeeded(roomId, member.userId);
    const hostChanged = Boolean(newHostId && newHostId !== oldHostId);
    if (room.members.size === 0) {
      deleteRoom(roomId);
      return { members: [], hostChanged, newHostId };
    }
    return { members: listMembers(roomId), hostChanged, newHostId: newHostId ?? null };
  }
  return { members: listMembers(roomId), hostChanged: false, newHostId: null };
}

export function listMembers(roomId: string): RoomMember[] {
  const room = getRoom(roomId);
  if (!room) return [];
  return [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
}

export function getQueue(roomId: string): VideoItem[] {
  return getRoom(roomId)?.queue ?? [];
}

export function getPlaybackSnapshot(roomId: string): PlaybackSnapshot | null {
  const room = getRoom(roomId);
  if (!room) return null;
  return snapshotPlayback(room.playback);
}

export function play(roomId: string, currentTime: number): PlaybackSnapshot | null {
  const room = getRoom(roomId);
  if (!room) return null;
  room.playback.currentTime = currentTime;
  room.playback.playing = true;
  room.playback.lastUpdated = Date.now();
  return snapshotPlayback(room.playback);
}

export function pause(roomId: string, currentTime: number): PlaybackSnapshot | null {
  const room = getRoom(roomId);
  if (!room) return null;
  room.playback.currentTime = currentTime;
  room.playback.playing = false;
  room.playback.lastUpdated = Date.now();
  return snapshotPlayback(room.playback);
}

export function seek(roomId: string, currentTime: number): PlaybackSnapshot | null {
  const room = getRoom(roomId);
  if (!room) return null;
  room.playback.currentTime = currentTime;
  room.playback.lastUpdated = Date.now();
  return snapshotPlayback(room.playback);
}

export function setSpeed(roomId: string, speed: number): PlaybackSnapshot | null {
  const room = getRoom(roomId);
  if (!room) return null;
  room.playback.speed = Math.max(0.25, Math.min(2, speed));
  room.playback.lastUpdated = Date.now();
  return snapshotPlayback(room.playback);
}

export function setCurrentVideo(
  roomId: string,
  video: VideoItem | null,
  autoplay = false
): PlaybackSnapshot | null {
  const room = getRoom(roomId);
  if (!room) return null;
  room.playback.currentVideo = video;
  room.playback.currentTime = 0;
  room.playback.playing = autoplay && video !== null;
  room.playback.speed = 1;
  room.playback.lastUpdated = Date.now();
  return snapshotPlayback(room.playback);
}

export function addToQueue(roomId: string, video: VideoItem): VideoItem[] | null {
  const room = getRoom(roomId);
  if (!room) return null;
  if (room.queue.length >= MAX_QUEUE) return null;
  room.queue.push(video);
  return [...room.queue];
}

export function removeFromQueue(roomId: string, itemId: string): VideoItem[] | null {
  const room = getRoom(roomId);
  if (!room) return null;
  const idx = room.queue.findIndex((item) => item.id === itemId);
  if (idx < 0) return null;
  room.queue.splice(idx, 1);
  if (room.playback.nextMode === "continue" && idx < room.playback.nextQueueIndex) {
    room.playback.nextQueueIndex = Math.max(0, room.playback.nextQueueIndex - 1);
  }
  return [...room.queue];
}

export function clearQueue(roomId: string): VideoItem[] | null {
  const room = getRoom(roomId);
  if (!room) return null;
  room.queue = [];
  room.playback.nextMode = null;
  room.playback.nextQueueIndex = 0;
  return [];
}

export function reorderQueue(
  roomId: string,
  itemId: string,
  direction: "up" | "down"
): VideoItem[] | null {
  const room = getRoom(roomId);
  if (!room) return null;
  const idx = room.queue.findIndex((item) => item.id === itemId);
  if (idx < 0) return null;
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= room.queue.length) return [...room.queue];
  [room.queue[idx], room.queue[swapWith]] = [room.queue[swapWith], room.queue[idx]];
  return [...room.queue];
}

export function moveToPlayNext(roomId: string, itemId: string): VideoItem[] | null {
  const room = getRoom(roomId);
  if (!room) return null;
  const idx = room.queue.findIndex((item) => item.id === itemId);
  if (idx < 0) return null;
  const [item] = room.queue.splice(idx, 1);
  room.queue.unshift(item);
  if (room.playback.nextMode === "continue") {
    room.playback.nextMode = null;
    room.playback.nextQueueIndex = 0;
  }
  return [...room.queue];
}

export function playQueueItem(
  roomId: string,
  itemId: string
): { video: VideoItem; queue: VideoItem[]; autoplay: boolean } | null {
  const room = getRoom(roomId);
  if (!room) return null;
  const idx = room.queue.findIndex((item) => item.id === itemId);
  if (idx < 0) return null;
  const settings = getSettings(roomId);
  const listMode = isListMode(settings);

  if (settings.queueAfterJump === "continue") {
    room.playback.nextMode = "continue";
    room.playback.nextQueueIndex = listMode ? idx + 1 : idx;
  } else {
    room.playback.nextMode = "resume_front";
    room.playback.nextQueueIndex = 0;
  }

  const video = listMode ? room.queue[idx]! : room.queue.splice(idx, 1)[0]!;
  setCurrentVideo(roomId, video, true);
  return { video, queue: [...room.queue], autoplay: true };
}

function queueIndexOfCurrent(room: RoomRuntime): number {
  const id = room.playback.currentVideo?.id;
  if (!id) return -1;
  return room.queue.findIndex((item) => item.id === id);
}

export function loadNextVideo(
  roomId: string
): { video: VideoItem; queue: VideoItem[]; autoplay: boolean } | "empty" | null {
  const room = getRoom(roomId);
  if (!room) return null;

  if (room.queue.length === 0) {
    setCurrentVideo(roomId, null, false);
    room.playback.nextMode = null;
    room.playback.nextQueueIndex = 0;
    return "empty";
  }

  const settings = getSettings(roomId);
  const listMode = isListMode(settings);
  let nextIdx: number;

  if (room.playback.nextMode === "continue") {
    nextIdx = room.playback.nextQueueIndex;
    room.playback.nextMode = null;
    room.playback.nextQueueIndex = 0;
  } else if (room.playback.nextMode === "resume_front") {
    nextIdx = 0;
    room.playback.nextMode = null;
    room.playback.nextQueueIndex = 0;
  } else if (settings.shuffle) {
    const curIdx = listMode ? queueIndexOfCurrent(room) : -1;
    nextIdx = pickRandomIndex(room.queue.length, curIdx);
  } else if (listMode) {
    const curIdx = queueIndexOfCurrent(room);
    nextIdx = curIdx >= 0 ? curIdx + 1 : 0;
  } else {
    nextIdx = 0;
  }

  if (nextIdx < 0 || nextIdx >= room.queue.length) {
    setCurrentVideo(roomId, null, false);
    room.playback.nextMode = null;
    room.playback.nextQueueIndex = 0;
    return "empty";
  }

  const video = listMode ? room.queue[nextIdx]! : room.queue.splice(nextIdx, 1)[0]!;
  setCurrentVideo(roomId, video, true);
  return { video, queue: [...room.queue], autoplay: true };
}

export function setVideoDirect(
  roomId: string,
  video: VideoItem
): { video: VideoItem; queue: VideoItem[]; autoplay: boolean } {
  const room = getRoom(roomId)!;
  room.playback.nextMode = null;
  room.playback.nextQueueIndex = 0;
  setCurrentVideo(roomId, video, true);
  return { video, queue: [...room.queue], autoplay: true };
}
