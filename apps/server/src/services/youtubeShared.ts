import { sanitizeTitle } from "../utils/validation";

export interface YouTubeVideoResult {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: string;
}

export interface SearchResponse {
  items: YouTubeVideoResult[];
  nextPageToken: string | null;
  error?: string;
}

export interface PlaylistResponse {
  playlistId: string;
  title: string;
  items: YouTubeVideoResult[];
  error?: string;
}

export function isoDurationToSeconds(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] ?? "0", 10);
  const m = parseInt(match[2] ?? "0", 10);
  const s = parseInt(match[3] ?? "0", 10);
  return h * 3600 + m * 60 + s;
}

export function formatDuration(seconds: number): string {
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  const h = Math.floor(seconds / 3600);
  const remainder = seconds % 3600;
  const m = Math.floor(remainder / 60);
  const s = remainder % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function youtubeThumbUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function snippetToVideo(
  snippet: {
    title?: string;
    channelTitle?: string;
    thumbnails?: Record<string, { url?: string }>;
  },
  videoId: string,
  durationSec = 0
): YouTubeVideoResult {
  return {
    videoId,
    title: sanitizeTitle(snippet.title ?? "Unknown"),
    channel: sanitizeTitle(snippet.channelTitle ?? ""),
    thumbnail: youtubeThumbUrl(videoId),
    duration: durationSec > 0 ? formatDuration(durationSec) : "",
  };
}
