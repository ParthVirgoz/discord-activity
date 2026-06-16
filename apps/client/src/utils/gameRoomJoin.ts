import type { Room } from "@colyseus/sdk";
import type { GameRoomState } from "../schema.js";
import { colyseusSDK } from "./Colyseus.js";

/** Must match production Railway registration in app.config.ts */
export const GAME_ROOM_NAME = "my_room";

/** @deprecated */
export const WATCH_ROOM_NAME = GAME_ROOM_NAME;

function activityInstanceKey(): string {
  try {
    return new URLSearchParams(window.location.search).get("frame_id") ?? "local";
  } catch {
    return "local";
  }
}

const roomIdStorageKey = (channelId: string) =>
  `discord-game:roomId:${channelId}:${activityInstanceKey()}`;

export function persistGameRoomId(channelId: string, roomId: string): void {
  try {
    sessionStorage.setItem(roomIdStorageKey(channelId), roomId);
  } catch {
    /* private browsing */
  }
}

export function clearPersistedGameRoomId(channelId: string): void {
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

export async function joinGameRoom(channelId: string): Promise<Room<GameRoomState>> {
  if (!channelId) {
    throw new Error("Missing Discord channelId — join a voice channel first");
  }

  const joinOptions = { channelId };
  const savedRoomId = readPersistedRoomId(channelId);

  if (savedRoomId) {
    try {
      const room = await colyseusSDK.joinById<GameRoomState>(savedRoomId, joinOptions);
      persistGameRoomId(channelId, room.roomId);
      return room;
    } catch {
      clearPersistedGameRoomId(channelId);
    }
  }

  const room = await colyseusSDK.joinOrCreate<GameRoomState>(GAME_ROOM_NAME, joinOptions);
  persistGameRoomId(channelId, room.roomId);
  return room;
}

/** @deprecated use joinGameRoom */
export const joinWatchRoom = joinGameRoom;

/** @deprecated */
export const persistWatchRoomId = persistGameRoomId;

/** @deprecated */
export const clearPersistedWatchRoomId = clearPersistedGameRoomId;
