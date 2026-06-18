const BOOTSTRAP_KEY = "synctube-bootstrap";

export function markRoomBootstrap(roomId: string, hostUserId: string) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(
    BOOTSTRAP_KEY,
    JSON.stringify({ roomId: roomId.toLowerCase(), hostUserId })
  );
}

export function consumeRoomBootstrap(roomId: string, userId: string): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(BOOTSTRAP_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { roomId?: string; hostUserId?: string };
    const match =
      parsed.roomId === roomId.toLowerCase() && parsed.hostUserId === userId;
    if (match) sessionStorage.removeItem(BOOTSTRAP_KEY);
    return match;
  } catch {
    return false;
  }
}
