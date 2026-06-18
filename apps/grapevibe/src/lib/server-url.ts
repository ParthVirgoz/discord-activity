/**
 * Backend base URL for split deploy (optional).
 * - Render / Docker: leave unset — client uses same origin.
 * - Vercel frontend: usually leave unset too; set BACKEND_URL in Vercel env
 *   so next.config rewrites proxy /api and /socket.io to Render.
 * - Set NEXT_PUBLIC_SERVER_URL only if you need the browser to talk to Render
 *   directly (bypasses Vercel rewrites).
 */
export function getServerUrl(): string {
  const url = process.env.NEXT_PUBLIC_SERVER_URL?.trim().replace(/\/$/, "");
  return url || "";
}

export function apiUrl(path: string): string {
  const base = getServerUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}

/** Socket.IO server URL (same rules as getServerUrl). */
export const getSocketServerUrl = getServerUrl;

/** True when the app is served from Vercel without a configured backend. */
export function isLikelyMisconfiguredVercelDeploy(): boolean {
  if (typeof window === "undefined") return false;
  if (getServerUrl()) return false;
  return window.location.hostname.endsWith(".vercel.app");
}
