import type { Room } from "@colyseus/sdk";

/** Tolerate Discord proxy / background-tab drops without giving up quickly. */
export function configureRoomResilience(room: Room): void {
  room.reconnection.enabled = true;
  room.reconnection.maxRetries = 50;
  room.reconnection.maxDelay = 15_000;
  room.reconnection.minDelay = 500;
  room.reconnection.minUptime = 0;
}

export function startRoomKeepAlive(
  room: Room,
  onSync?: () => void,
  intervalMs = 15_000
): () => void {
  let syncCounter = 0;
  const timer = setInterval(() => {
    if (!room.connection?.isOpen) return;
    room.ping(() => {});
    syncCounter += 1;
    if (onSync && syncCounter % 2 === 0) {
      onSync();
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
