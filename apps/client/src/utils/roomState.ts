import type { Room } from "@colyseus/sdk";
import type { GameRoomState } from "../schema.js";

export function isGameRoom(room: Room<GameRoomState>): boolean {
  const state = room.state as GameRoomState & { players?: unknown; queue?: unknown };
  if (state.players || state.queue) {
    return false;
  }
  return state.members != null && typeof state.members.forEach === "function";
}

/** Wait until Colyseus exposes the game room schema. */
export function waitForGameState(room: Room<GameRoomState>, timeoutMs = 8000): Promise<void> {
  if (isGameRoom(room) && room.state.board?.length === 9) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      if (isGameRoom(room)) {
        resolve();
      } else {
        reject(new Error("GAME_ROOM_STATE_UNAVAILABLE"));
      }
    }, timeoutMs);

    const onChange = () => {
      if (isGameRoom(room)) {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      room.onStateChange.remove(onChange);
    };

    room.onStateChange(onChange);
    onChange();
  });
}

export function getGameRoomErrorMessage(): string {
  return "Server is still on the old watch-together build. Redeploy the latest server to Railway, then reopen the Activity.";
}

/** @deprecated use waitForGameState */
export const waitForWatchState = waitForGameState;

/** @deprecated use getGameRoomErrorMessage */
export const getWatchRoomErrorMessage = getGameRoomErrorMessage;

/** @deprecated */
export const isWatchTogetherRoom = isGameRoom;
