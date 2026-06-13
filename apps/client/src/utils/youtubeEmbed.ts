import { isDiscordActivity } from "./discordUrls.js";

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

function buildEmbedParams(
  startSec: number,
  autoplay: boolean,
  pageOrigin: string,
  pageHref: string,
  includeReferrer: boolean
): URLSearchParams {
  const params = new URLSearchParams({
    start: String(Math.max(0, Math.floor(startSec))),
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    enablejsapi: "1",
    origin: pageOrigin,
  });
  if (includeReferrer) params.set("widget_referrer", pageHref);
  if (autoplay) params.set("autoplay", "1");
  return params;
}

export function buildYouTubeEmbedUrl(
  videoId: string,
  startSec: number,
  autoplay: boolean,
  embedHost?: "youtube" | "nocookie",
  pageOrigin = typeof window !== "undefined" ? window.location.origin : "",
  pageHref = typeof window !== "undefined" ? window.location.href : ""
): string {
  // Discord: load youtube.com directly in the activity iframe.
  // Proxied youtube URLs break (58-byte error); server wrapper inner iframe is CSP-blocked.
  if (isDiscordActivity()) {
    const params = buildEmbedParams(startSec, autoplay, pageOrigin, pageHref, false);
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`;
  }

  const base =
    embedHost === "youtube"
      ? "https://www.youtube.com"
      : "https://www.youtube-nocookie.com";
  const params = buildEmbedParams(startSec, autoplay, pageOrigin, pageHref, true);
  return `${base}/embed/${encodeURIComponent(videoId)}?${params}`;
}
