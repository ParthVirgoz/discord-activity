const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

const URL_PATTERNS = [
  /(?:youtube\.com\/watch\?.*v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
];

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

const PLAYLIST_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (PLAYLIST_ID_REGEX.test(trimmed) && trimmed.length <= 64) return trimmed;

  try {
    const url = new URL(trimmed);
    const list = url.searchParams.get("list");
    if (list && PLAYLIST_ID_REGEX.test(list)) return list;
  } catch {
    const match = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function isPlaylistUrl(input: string): boolean {
  return parsePlaylistId(input) !== null;
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
