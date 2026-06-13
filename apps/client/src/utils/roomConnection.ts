import type { Room } from "@colyseus/sdk";

/** Tolerate Discord proxy / background-tab drops without giving up quickly. */
export function configureRoomResilience(room: Room): void {
  room.reconnection.maxRetries = 30;
  room.reconnection.maxDelay = 10_000;
  room.reconnection.minDelay = 500;
  room.reconnection.minUptime = 3_000;
}

export function startRoomKeepAlive(room: Room, intervalMs = 20_000): () => void {
  const timer = setInterval(() => {
    if (room.connection?.isOpen) {
      room.ping(() => {});
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
