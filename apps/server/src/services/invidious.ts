import { isValidVideoId, sanitizeTitle } from "../utils/validation";
import {
  formatDuration,
  youtubeThumbUrl,
  type YouTubeVideoResult,
  type SearchResponse,
  type PlaylistResponse,
} from "./youtubeShared";

const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.privacydev.net",
  "https://vid.puffyan.us",
  "https://invidious.protokolla.fi",
];

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_SIZE = 256;
const SEARCH_PAGE_SIZE = 18;
const MAX_PLAYLIST_VIDEOS = 50;

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

async function invidiousFetch(path: string): Promise<Response | null> {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return res;
    } catch {
      // try next
    }
  }
  return null;
}

interface InvidiousVideo {
  type?: string;
  videoId?: string;
  title?: string;
  author?: string;
  videoThumbnails?: { quality?: string; url?: string }[];
  lengthSeconds?: number;
}

function invidiousToVideo(entry: InvidiousVideo): YouTubeVideoResult | null {
  if (!entry.videoId || !isValidVideoId(entry.videoId)) return null;
  const thumbs = entry.videoThumbnails ?? [];
  const best =
    thumbs.find((t) => t.quality === "medium")?.url ??
    thumbs.find((t) => t.quality === "high")?.url ??
    thumbs[0]?.url ??
    youtubeThumbUrl(entry.videoId);

  const durationSec =
    typeof entry.lengthSeconds === "number" ? Math.max(0, entry.lengthSeconds) : 0;

  return {
    videoId: entry.videoId,
    title: sanitizeTitle(entry.title ?? "Unknown"),
    channel: sanitizeTitle(entry.author ?? ""),
    thumbnail: best,
    duration: durationSec > 0 ? formatDuration(durationSec) : "",
  };
}

export async function searchViaInvidious(query: string, pageToken = ""): Promise<SearchResponse> {
  const page = pageToken ? Math.max(1, parseInt(pageToken, 10) || 1) : 1;
  const cacheKey = `invidious:search:${query}:${page}`;
  const cached = cacheGet<SearchResponse>(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    q: query,
    type: "video",
    page: String(page),
  });

  const res = await invidiousFetch(`/api/v1/search?${params}`);
  if (!res) {
    return { items: [], nextPageToken: null, error: "Search unavailable" };
  }

  const data = (await res.json()) as InvidiousVideo[];
  const items: YouTubeVideoResult[] = [];

  for (const entry of data) {
    if (entry.type && entry.type !== "video") continue;
    const video = invidiousToVideo(entry);
    if (video) items.push(video);
    if (items.length >= SEARCH_PAGE_SIZE) break;
  }

  const result: SearchResponse = {
    items,
    nextPageToken: items.length >= SEARCH_PAGE_SIZE ? String(page + 1) : null,
  };
  if (items.length > 0) cacheSet(cacheKey, result);
  return result;
}

export async function importPlaylistViaInvidious(playlistId: string): Promise<PlaylistResponse> {
  const cacheKey = `invidious:playlist:${playlistId}`;
  const cached = cacheGet<PlaylistResponse>(cacheKey);
  if (cached) return cached;

  const res = await invidiousFetch(`/api/v1/playlists/${encodeURIComponent(playlistId)}`);
  if (!res) {
    return { playlistId, title: "", items: [], error: "Playlist lookup failed" };
  }

  const data = await res.json();
  const items: YouTubeVideoResult[] = [];

  for (const entry of data.videos ?? []) {
    const video = invidiousToVideo(entry as InvidiousVideo);
    if (video) items.push(video);
    if (items.length >= MAX_PLAYLIST_VIDEOS) break;
  }

  const result: PlaylistResponse = {
    playlistId,
    title: sanitizeTitle(data.title ?? "Playlist"),
    items,
    error: items.length === 0 ? "Playlist is empty or private" : undefined,
  };
  if (items.length > 0) cacheSet(cacheKey, result);
  return result;
}
