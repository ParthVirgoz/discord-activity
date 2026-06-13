import type { Room } from "@colyseus/sdk";

/** Tolerate Discord proxy / background-tab drops without giving up quickly. */
export function configureRoomResilience(room: Room): void {
  room.reconnection.enabled = true;
  room.reconnection.maxRetries = 64;
  room.reconnection.maxDelay = 20_000;
  room.reconnection.minDelay = 400;
  room.reconnection.minUptime = 0;
}

export function safeRoomSend(room: Room, type: string, data: Record<string, unknown> = {}): boolean {
  try {
    if (!room.connection?.isOpen) return false;
    room.send(type, data);
    return true;
  } catch (err) {
    console.warn(`[room] send ${type} failed:`, err);
    return false;
  }
}

export function startRoomKeepAlive(
  room: Room,
  onSync?: () => void,
  intervalMs = 12_000
): () => void {
  let syncCounter = 0;
  const timer = setInterval(() => {
    if (!room.connection?.isOpen) return;
    room.ping(() => {});
    syncCounter += 1;
    if (onSync && syncCounter % 3 === 0) {
      onSync();
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

export function bindNetworkRecoveryHandlers(room: Room, onRecover: () => void): () => void {
  const handleOnline = () => onRecover();
  const handleVisibility = () => {
    if (document.visibilityState === "visible") onRecover();
  };
  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibility);
  return () => {
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}
