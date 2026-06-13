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

/** Wait until Colyseus exposes the watch-room schema (members + queue). */
export function waitForWatchState(room: Room<WatchRoomState>, timeoutMs = 8000): Promise<void> {
  if (isWatchTogetherRoom(room)) {
    return waitForStatePatch(room, timeoutMs);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      if (isWatchTogetherRoom(room)) {
        resolve(waitForStatePatch(room, Math.max(2000, timeoutMs - 2000)));
      } else {
        reject(new Error("WATCH_ROOM_STATE_UNAVAILABLE"));
      }
    }, timeoutMs);

    const onChange = () => {
      if (isWatchTogetherRoom(room)) {
        cleanup();
        resolve(waitForStatePatch(room, Math.max(2000, timeoutMs - 2000)));
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

/**
 * After schema exists, wait for the first decoded state patch so queue/members
 * are populated before client bootstrap (critical for reconnect).
 */
function waitForStatePatch(room: Room<WatchRoomState>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let patchSeen = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      room.onStateChange.remove(onChange);
      clearTimeout(timer);
      resolve();
    };

    const onChange = () => {
      patchSeen = true;
      requestAnimationFrame(finish);
    };

    const timer = setTimeout(finish, timeoutMs);
    room.onStateChange(onChange);

    // Colyseus may expose schema before the first patch is applied — wait one frame.
    requestAnimationFrame(() => {
      if (!patchSeen && room.state?.members != null) {
        onChange();
      }
    });
  });
}

export function getWatchRoomErrorMessage(): string {
  return "Server is still on the old game build. In Railway: leave Root Directory empty (repo root), set JWT_SECRET + Discord env vars, redeploy latest main, then retry.";
}
