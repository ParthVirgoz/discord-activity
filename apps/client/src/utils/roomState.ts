import type { Room } from "@colyseus/sdk";
import type { WatchRoomState } from "../schema.js";

type LegacyGameState = WatchRoomState & { players?: unknown };

export function isWatchTogetherRoom(room: Room<WatchRoomState>): boolean {
  const state = room.state as LegacyGameState;
  if (state.players && !state.members) {
    return false;
  }
  return (
    state.members != null &&
    typeof state.members.forEach === "function" &&
    state.queue != null &&
    typeof state.queue.forEach === "function"
  );
}

export function waitForWatchState(room: Room<WatchRoomState>, timeoutMs = 5000): Promise<void> {
  if (isWatchTogetherRoom(room)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      if (isWatchTogetherRoom(room)) {
        resolve();
      } else {
        reject(new Error("WATCH_ROOM_STATE_UNAVAILABLE"));
      }
    }, timeoutMs);

    const onChange = () => {
      if (isWatchTogetherRoom(room)) {
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

export function getWatchRoomErrorMessage(): string {
  return "Server is still on the old game build. In Railway: leave Root Directory empty (repo root), set JWT_SECRET + Discord env vars, redeploy latest main, then retry.";
}
