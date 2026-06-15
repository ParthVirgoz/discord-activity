import type { Room } from "@colyseus/sdk";
import type { WatchRoomState } from "../schema.js";
import type { SyncPayload } from "../ui/WatchApp.js";

export type BufferedSessionSync = {
  isHost: boolean;
  sync: SyncPayload;
};

type SessionBuffer = {
  roomJoined?: BufferedSessionSync;
  reconnected?: BufferedSessionSync;
};

const bufferKey = Symbol("watchRoomSessionBuffer");
const attachedKey = Symbol("watchRoomMessageBufferAttached");

/** Register immediately after join — server sends roomJoined before WatchApp mounts. */
export function attachWatchRoomMessageBuffer(room: Room<WatchRoomState>): void {
  const roomRef = room as Room<WatchRoomState> & {
    [attachedKey]?: boolean;
    [bufferKey]?: SessionBuffer;
  };
  if (roomRef[attachedKey]) return;
  roomRef[attachedKey] = true;
  roomRef[bufferKey] = {};

  room.onMessage("roomJoined", (data: BufferedSessionSync) => {
    roomRef[bufferKey]!.roomJoined = data;
  });

  room.onMessage("reconnected", (data: BufferedSessionSync) => {
    roomRef[bufferKey]!.reconnected = data;
  });

  // Prevent Colyseus warnings if these arrive before WatchApp binds handlers.
  room.onMessage("queueEmpty", () => {});
  room.onMessage("batchQueued", () => {});
}

export function takeBufferedSessionSync(room: Room<WatchRoomState>): BufferedSessionSync | null {
  const roomRef = room as Room<WatchRoomState> & { [bufferKey]?: SessionBuffer };
  const buf = roomRef[bufferKey];
  if (!buf) return null;

  const data = buf.reconnected ?? buf.roomJoined ?? null;
  buf.reconnected = undefined;
  buf.roomJoined = undefined;
  return data;
}
