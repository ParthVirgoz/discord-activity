import type { Room } from "@colyseus/sdk";
import type { GameRoomState } from "../schema.js";

export function isGameRoom(room: Room<GameRoomState>): boolean {
  const state = room.state as GameRoomState & {
    board?: unknown;
    queue?: unknown;
    players?: unknown;
    options?: unknown;
  };
  if (state.board || state.queue || state.players || state.options) {
    return false;
  }
  return (
    state.members != null &&
    typeof state.members.forEach === "function" &&
    state.handCounts != null &&
    state.topCard != null
  );
}

export function waitForGameState(room: Room<GameRoomState>, timeoutMs = 8000): Promise<void> {
  if (isGameRoom(room)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      if (isGameRoom(room)) resolve();
      else reject(new Error("GAME_ROOM_STATE_UNAVAILABLE"));
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
  return "Server is still on an old build. Redeploy the latest server to Railway, then reopen the Activity.";
}

export const waitForWatchState = waitForGameState;
export const getWatchRoomErrorMessage = getGameRoomErrorMessage;
export const isWatchTogetherRoom = isGameRoom;
