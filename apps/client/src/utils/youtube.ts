const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

const URL_PATTERNS = [
  /(?:youtube\.com\/watch\?.*v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
];

/** YouTube playlist IDs use known prefixes — bare search words must not match. */
const BARE_PLAYLIST_ID_REGEX = /^(PL|RD|UU|OLAK5uy_|FL|LL|VL)[a-zA-Z0-9_-]{8,}$/;

const PLAYLIST_LIST_PARAM_REGEX = /^[a-zA-Z0-9_-]+$/;

const YOUTUBE_HOST_REGEX = /(?:^|[/:])(?:www\.)?(?:youtube\.com|youtu\.be)/i;

export function isValidVideoId(videoId: string): boolean {
  return YOUTUBE_ID_REGEX.test(videoId);
}

export function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isValidVideoId(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v && isValidVideoId(v)) return v;
    }
  } catch {
    // not a URL — try regex below
  }

  for (const pattern of URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1] && isValidVideoId(match[1])) return match[1];
  }

  return null;
}

function parsePlaylistIdFromUrl(trimmed: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.hostname.includes("youtube.com") || url.hostname === "youtu.be") {
      const list = url.searchParams.get("list");
      if (list && PLAYLIST_LIST_PARAM_REGEX.test(list)) return list;
    }
  } catch {
    const match = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const fromUrl = parsePlaylistIdFromUrl(trimmed);
  if (fromUrl) return fromUrl;

  if (BARE_PLAYLIST_ID_REGEX.test(trimmed) && trimmed.length <= 64) return trimmed;

  return null;
}

export function isPlaylistUrl(input: string): boolean {
  return parsePlaylistId(input) !== null;
}

/** True when input is a YouTube link/ID to add — not a plain search query. */
export function isYouTubeLinkInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (parseYouTubeId(trimmed)) return true;
  if (parsePlaylistId(trimmed)) return true;
  return YOUTUBE_HOST_REGEX.test(trimmed);
}

/** Parse YouTube duration strings like "3:45" or "1:02:03" to seconds. */
export function parseDurationToSeconds(duration: string): number {
  if (!duration) return 0;
  const parts = duration.split(":").map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

/** Format seconds as m:ss or h:mm:ss. */
export function formatDurationSeconds(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function getYouTubeThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

export async function fetchVideoTitle(videoId: string): Promise<string> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return "";
    const data = await res.json();
    return typeof data.title === "string" ? data.title.slice(0, 200) : "";
  } catch {
    return "";
  }
}
