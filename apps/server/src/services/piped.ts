import { isValidVideoId, sanitizeTitle } from "../utils/validation";
import {
  formatDuration,
  youtubeThumbUrl,
  type YouTubeVideoResult,
  type SearchResponse,
  type PlaylistResponse,
} from "./youtubeShared";
import { PIPED_INSTANCES } from "./pipedInstances";

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_SIZE = 256;
const MAX_PLAYLIST_VIDEOS = 50;
const SEARCH_PAGE_SIZE = 20;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function cacheSet<T>(key: string, value: T): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function extractVideoIdFromPipedUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const match = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})(?:[&?]|$)/);
  return match?.[1] && isValidVideoId(match[1]) ? match[1] : null;
}

interface PipedStreamItem {
  type?: string;
  title?: string;
  url?: string;
  thumbnail?: string;
  uploaderName?: string;
  duration?: number;
}

export async function pipedFetch(path: string): Promise<Response | null> {
  const attempts = PIPED_INSTANCES.map(async (base) => {
    const res = await fetch(`${base}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    return res;
  });

  const results = await Promise.allSettled(attempts);
  for (const result of results) {
    if (result.status === "fulfilled") return result.value;
  }
  return null;
}

function streamToVideo(item: PipedStreamItem): YouTubeVideoResult | null {
  const videoId = extractVideoIdFromPipedUrl(item.url ?? "");
  if (!videoId) return null;

  const durationSec = typeof item.duration === "number" ? Math.max(0, item.duration) : 0;
  return {
    videoId,
    title: sanitizeTitle(item.title ?? "Unknown"),
    channel: sanitizeTitle(item.uploaderName ?? ""),
    thumbnail: youtubeThumbUrl(videoId),
    duration: durationSec > 0 ? formatDuration(durationSec) : "",
  };
}

export async function searchViaPiped(query: string, pageToken = ""): Promise<SearchResponse> {
  const cacheKey = `piped:search:${query}:${pageToken}`;
  const cached = cacheGet<SearchResponse>(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    q: query,
    filter: "videos",
  });
  if (pageToken) params.set("nextpage", pageToken);

  const res = await pipedFetch(`/search?${params}`);
  if (!res) {
    return { items: [], nextPageToken: null, error: "YouTube browse unavailable. Try again." };
  }

  const data = await res.json();
  const items: YouTubeVideoResult[] = [];

  for (const entry of data.items ?? []) {
    if (entry?.type && entry.type !== "stream") continue;
    const video = streamToVideo(entry as PipedStreamItem);
    if (video) items.push(video);
    if (items.length >= SEARCH_PAGE_SIZE) break;
  }

  const result: SearchResponse = {
    items,
    nextPageToken: typeof data.nextpage === "string" && data.nextpage ? data.nextpage : null,
  };
  cacheSet(cacheKey, result);
  return result;
}

export async function importPlaylistViaPiped(playlistId: string): Promise<PlaylistResponse> {
  const cacheKey = `piped:playlist:${playlistId}`;
  const cached = cacheGet<PlaylistResponse>(cacheKey);
  if (cached) return cached;

  const res = await pipedFetch(`/playlists/${encodeURIComponent(playlistId)}`);
  if (!res) {
    return { playlistId, title: "", items: [], error: "Playlist lookup failed" };
  }

  const data = await res.json();
  const items: YouTubeVideoResult[] = [];

  for (const entry of data.relatedStreams ?? []) {
    const video = streamToVideo(entry as PipedStreamItem);
    if (video) items.push(video);
    if (items.length >= MAX_PLAYLIST_VIDEOS) break;
  }

  const result: PlaylistResponse = {
    playlistId,
    title: sanitizeTitle(data.name ?? "Playlist"),
    items,
    error: items.length === 0 ? "Playlist is empty or private" : undefined,
  };
  cacheSet(cacheKey, result);
  return result;
}

export function clearPipedCache(): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith("piped:")) cache.delete(key);
  }
}
