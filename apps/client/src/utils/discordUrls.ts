/** True when running inside Discord's activity iframe (discordsays.com). */
export function isDiscordActivity(
  hostname = typeof window !== "undefined" ? window.location.hostname : "",
  search = typeof window !== "undefined" ? window.location.search : ""
): boolean {
  if (hostname.includes("discordsays.com")) return true;
  return new URLSearchParams(search).has("frame_id");
}

/** Colyseus / API prefix — must match Discord URL mapping `/.proxy/colyseus` → server. */
export function getServerProxyPrefix(): string {
  if (isDiscordActivity()) return "/.proxy/colyseus";
  const configured = import.meta.env.VITE_COLYSEUS_URL;
  if (typeof configured === "string" && configured.length > 0) return configured.replace(/\/$/, "");
  return "/colyseus";
}

/**
 * YouTube embed host for iframe src.
 * In Discord, map `/.proxy/youtube-nocookie` → `www.youtube-nocookie.com` in the Developer Portal.
 */
export function getYouTubeEmbedBase(): string {
  if (isDiscordActivity()) return "/.proxy/youtube-nocookie";
  return "https://www.youtube-nocookie.com";
}

/**
 * Thumbnail URL for <img> tags.
 * Discord blocks direct ytimg.com — use server proxy (needs /.proxy/colyseus mapping)
 * or ytimg mapping (/.proxy/ytimg → i.ytimg.com) via patchUrlMappings.
 */
export function getYouTubeThumbnailUrl(videoId: string): string {
  const id = encodeURIComponent(videoId);
  if (isDiscordActivity()) {
    return `${getServerProxyPrefix()}/api/youtube/thumbnail/${id}`;
  }
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Origins accepted for YouTube iframe postMessage (includes Discord proxy). */
export function getYouTubeEmbedMessageOrigins(pageOrigin = window.location.origin): string[] {
  const origins = new Set([
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    pageOrigin,
  ]);
  return [...origins];
}

/** Target origin when posting commands into the YouTube iframe. */
export function getYouTubeEmbedPostMessageTarget(pageOrigin = window.location.origin): string {
  return isDiscordActivity() ? pageOrigin : "https://www.youtube-nocookie.com";
}
