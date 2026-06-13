/** True when running inside Discord's activity iframe (discordsays.com). */
export function isDiscordActivity(
  hostname = typeof window !== "undefined" ? window.location.hostname : "",
  search = typeof window !== "undefined" ? window.location.search : ""
): boolean {
  if (hostname.includes("discordsays.com")) return true;
  return new URLSearchParams(search).has("frame_id");
}

/**
 * Runtime path inside Discord's iframe.
 * Portal mapping uses `/colyseus` (no `.proxy`), but requests at runtime use `/.proxy/colyseus`.
 */
export function discordRuntimePath(portalPath: string): string {
  const normalized = portalPath.startsWith("/") ? portalPath : `/${portalPath}`;
  if (!isDiscordActivity()) return normalized;
  if (normalized.startsWith("/.proxy/")) return normalized;
  return `/.proxy${normalized}`;
}

/**
 * Colyseus / API prefix.
 * Production Discord: `/.proxy/colyseus` (set VITE_COLYSEUS_URL on Vercel).
 * Local dev: `/colyseus` (Vite proxy).
 */
export function getServerProxyPrefix(): string {
  const configured = import.meta.env.VITE_COLYSEUS_URL;
  if (typeof configured === "string" && configured.length > 0) return configured.replace(/\/$/, "");
  if (isDiscordActivity()) return discordRuntimePath("/colyseus");
  return "/colyseus";
}

/**
 * YouTube embed base for iframe src (non-Discord only).
 * In Discord, buildYouTubeEmbedUrl uses the server player wrapper instead.
 */
export function getYouTubeEmbedBase(): string {
  return "https://www.youtube-nocookie.com";
}

/** Thumbnail URL — proxied through our server in Discord. */
export function getYouTubeThumbnailUrl(videoId: string): string {
  const id = encodeURIComponent(videoId);
  if (isDiscordActivity()) {
    return `${getServerProxyPrefix()}/api/youtube/thumbnail/${id}`;
  }
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Origins accepted for YouTube iframe postMessage (includes Discord proxy). */
export function getYouTubeEmbedMessageOrigins(pageOrigin = window.location.origin): string[] {
  return [
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    pageOrigin,
  ];
}

/** Target origin when posting commands into the YouTube iframe. */
export function getYouTubeEmbedPostMessageTarget(pageOrigin = window.location.origin): string {
  // Discord: outer iframe is our player wrapper on the same discordsays.com origin.
  if (isDiscordActivity()) return pageOrigin;
  return "https://www.youtube-nocookie.com";
}

