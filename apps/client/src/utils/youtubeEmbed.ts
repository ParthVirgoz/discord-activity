import { isDiscordActivity, getYouTubeEmbedBase } from "./discordUrls.js";

/** True when the page is served from a raw IP — YouTube often blocks music/copyright embeds in that case. */
export function isRawIpHost(
  hostname = typeof window !== "undefined" ? window.location.hostname : ""
): boolean {
  if (!hostname) return false;
  if (hostname === "localhost") return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  if (hostname.startsWith("[") && hostname.endsWith("]")) return true;
  return false;
}

export { isDiscordActivity } from "./discordUrls.js";

export function buildYouTubeEmbedUrl(
  videoId: string,
  startSec: number,
  autoplay: boolean,
  embedHost?: "youtube" | "nocookie",
  pageOrigin = typeof window !== "undefined" ? window.location.origin : "",
  pageHref = typeof window !== "undefined" ? window.location.href : ""
): string {
  const base = isDiscordActivity()
    ? getYouTubeEmbedBase()
    : embedHost === "youtube"
      ? "https://www.youtube.com"
      : "https://www.youtube-nocookie.com";

  const params = new URLSearchParams({
    start: String(Math.max(0, Math.floor(startSec))),
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    enablejsapi: "1",
    origin: pageOrigin,
    widget_referrer: pageHref,
  });
  if (autoplay) params.set("autoplay", "1");

  return `${base}/embed/${encodeURIComponent(videoId)}?${params}`;
}
