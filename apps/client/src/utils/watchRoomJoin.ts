import type { Room } from "@colyseus/sdk";
import type { WatchRoomState } from "../schema.js";
import { colyseusSDK } from "./Colyseus.js";
import { attachWatchRoomMessageBuffer } from "./watchRoomMessageBuffer.js";

/** Must match production Railway registration in app.config.ts */
export const WATCH_ROOM_NAME = "my_room";

const roomIdStorageKey = (channelId: string) => `synctube:roomId:${channelId}`;

export function persistWatchRoomId(channelId: string, roomId: string): void {
  try {
    sessionStorage.setItem(roomIdStorageKey(channelId), roomId);
  } catch {
    /* private browsing */
  }
}

export function clearPersistedWatchRoomId(channelId: string): void {
  try {
    sessionStorage.removeItem(roomIdStorageKey(channelId));
  } catch {
    /* ignore */
  }
}

function readPersistedRoomId(channelId: string): string | null {
  try {
    return sessionStorage.getItem(roomIdStorageKey(channelId));
  } catch {
    return null;
  }
}

/**
 * Join the single shared watch room for a Discord voice channel.
 * Never alternates room names — two names previously created duplicate empty rooms.
 */
export async function joinWatchRoom(channelId: string): Promise<Room<WatchRoomState>> {
  if (!channelId) {
    throw new Error("Missing Discord channelId — cannot join watch room");
  }

  const joinOptions = { channelId };
  const savedRoomId = readPersistedRoomId(channelId);

  if (savedRoomId) {
    try {
      const room = await colyseusSDK.joinById<WatchRoomState>(savedRoomId, joinOptions);
      attachWatchRoomMessageBuffer(room);
      persistWatchRoomId(channelId, room.roomId);
      console.info(
        `[synctube] rejoined room by id roomId=${room.roomId} channelId=${channelId} queueLength=${room.state?.queue?.length ?? 0}`
      );
      return room;
    } catch (err) {
      console.warn("[synctube] joinById failed, falling back to joinOrCreate:", err);
      clearPersistedWatchRoomId(channelId);
    }
  }

  const room = await colyseusSDK.joinOrCreate<WatchRoomState>(WATCH_ROOM_NAME, joinOptions);
  attachWatchRoomMessageBuffer(room);
  persistWatchRoomId(channelId, room.roomId);
  console.info(
    `[synctube] joined room roomId=${room.roomId} channelId=${channelId} queueLength=${room.state?.queue?.length ?? 0}`
  );
  return room;
}
