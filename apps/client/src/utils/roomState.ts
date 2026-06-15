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

function stateHasDecodedData(room: Room<WatchRoomState>): boolean {
  const members = room.state?.members;
  const queue = room.state?.queue;
  const memberCount = members && typeof members.size === "number" ? members.size : 0;
  const queueLength = queue && typeof queue.length === "number" ? queue.length : 0;
  return memberCount > 0 || queueLength > 0;
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
 * After schema exists, wait for decoded queue/member data before bootstrap.
 * Uses setTimeout(0) instead of rAF so hidden Discord tabs don't stall.
 */
function waitForStatePatch(room: Room<WatchRoomState>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let patchCount = 0;
    const hasVideo = () => !!room.state?.videoId;
    const queueReady = () => {
      const queueLen = room.state?.queue?.length ?? 0;
      if (queueLen > 0) return true;
      // Empty room or cleared queue — one patch is enough.
      return patchCount >= 1 && !hasVideo();
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      room.onStateChange.remove(onChange);
      clearTimeout(timer);
      resolve();
    };

    const onChange = () => {
      patchCount += 1;
      if (stateHasDecodedData(room) && (queueReady() || patchCount >= 2)) {
        setTimeout(finish, 0);
      }
    };

    const timer = setTimeout(finish, timeoutMs);
    room.onStateChange(onChange);

    setTimeout(() => {
      if (!settled && stateHasDecodedData(room)) {
        onChange();
      }
    }, 0);
  });
}

export function getWatchRoomErrorMessage(): string {
  return "Server is still on the old game build. In Railway: leave Root Directory empty (repo root), set JWT_SECRET + Discord env vars, redeploy latest main, then retry.";
}
