import { isValidVideoId, sanitizeTitle } from "../utils/validation";
import { searchYouTubeBrowse, importYouTubeBrowsePlaylist } from "./browse";

const BASE_URL = "https://www.googleapis.com/youtube/v3";
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_SIZE = 256;
const MAX_PLAYLIST_VIDEOS = 50;
const SEARCH_PAGE_SIZE = 12;

const PLAYLIST_LIST_PARAM_REGEX = /^[a-zA-Z0-9_-]+$/;
const BARE_PLAYLIST_ID_REGEX = /^(PL|RD|UU|OLAK5uy_|FL|LL|VL)[a-zA-Z0-9_-]{8,}$/;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

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

function getApiKey(): string {
  return process.env.YOUTUBE_API_KEY ?? "";
}

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

export function sanitizeSearchQuery(query: unknown): string {
  if (typeof query !== "string") return "";
  return query.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 100);
}

export function parsePlaylistId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

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

  if (BARE_PLAYLIST_ID_REGEX.test(trimmed) && trimmed.length <= 64) {
    return trimmed;
  }
  return null;
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

function pickThumbnail(thumbnails: Record<string, { url?: string }>): string {
  return (
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url ??
    ""
  );
}

function snippetToVideo(
  snippet: {
    title?: string;
    channelTitle?: string;
    thumbnails?: Record<string, { url?: string }>;
  },
  videoId: string,
  contentDetails?: { duration?: string }
): YouTubeVideoResult {
  const durationSec = contentDetails?.duration
    ? isoDurationToSeconds(contentDetails.duration)
    : 0;
  return {
    videoId,
    title: sanitizeTitle(snippet.title ?? "Unknown"),
    channel: sanitizeTitle(snippet.channelTitle ?? ""),
    thumbnail: pickThumbnail(snippet.thumbnails ?? {}),
    duration: durationSec > 0 ? formatDuration(durationSec) : "",
  };
}

async function fetchVideoDetails(
  videoIds: string[]
): Promise<Map<string, { contentDetails?: { duration?: string } }>> {
  const apiKey = getApiKey();
  const validIds = videoIds.filter(isValidVideoId);
  if (!apiKey || validIds.length === 0) return new Map();

  const url = new URL(`${BASE_URL}/videos`);
  url.searchParams.set("part", "contentDetails");
  url.searchParams.set("id", validIds.join(","));
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) return new Map();
  const data = await res.json();
  const map = new Map<string, { contentDetails?: { duration?: string } }>();
  for (const item of data.items ?? []) {
    map.set(item.id, item);
  }
  return map;
}

export async function searchVideos(
  query: string,
  pageToken = ""
): Promise<SearchResponse> {
  const browse = await searchYouTubeBrowse(query, pageToken);
  if (browse.items.length > 0 || browse.nextPageToken) {
    return browse;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return browse.error
      ? browse
      : { items: [], nextPageToken: null, error: "No videos found" };
  }

  const cacheKey = `search:${query}:${pageToken}`;
  const cached = cacheGet<SearchResponse>(cacheKey);
  if (cached) return cached;

  const url = new URL(`${BASE_URL}/search`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("maxResults", String(SEARCH_PAGE_SIZE));
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    return { items: [], nextPageToken: null, error: "YouTube search failed" };
  }

  const data = await res.json();
  const videoIds: string[] = [];
  for (const item of data.items ?? []) {
    const id = item?.id?.videoId;
    if (isValidVideoId(id)) videoIds.push(id);
  }

  const details = await fetchVideoDetails(videoIds);
  const items: YouTubeVideoResult[] = [];
  for (const item of data.items ?? []) {
    const videoId = item?.id?.videoId;
    if (!isValidVideoId(videoId)) continue;
    items.push(
      snippetToVideo(item.snippet ?? {}, videoId, details.get(videoId)?.contentDetails)
    );
  }

  const result: SearchResponse = {
    items,
    nextPageToken: data.nextPageToken ?? null,
  };
  cacheSet(cacheKey, result);
  return result;
}

export async function importPlaylist(playlistId: string): Promise<PlaylistResponse> {
  if (!PLAYLIST_ID_REGEX.test(playlistId) || playlistId.length > 64) {
    return { playlistId, title: "", items: [], error: "Invalid playlist ID" };
  }

  const browse = await importYouTubeBrowsePlaylist(playlistId);
  if (browse.items.length > 0) {
    return browse;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return browse.error
      ? browse
      : { playlistId, title: "", items: [], error: "Playlist not found" };
  }

  const cacheKey = `playlist:${playlistId}`;
  const cached = cacheGet<PlaylistResponse>(cacheKey);
  if (cached) return cached;

  const plUrl = new URL(`${BASE_URL}/playlists`);
  plUrl.searchParams.set("part", "snippet");
  plUrl.searchParams.set("id", playlistId);
  plUrl.searchParams.set("key", apiKey);

  const plRes = await fetch(plUrl.toString());
  if (!plRes.ok) {
    return { playlistId, title: "", items: [], error: "Playlist lookup failed" };
  }

  const plData = await plRes.json();
  const plItem = plData.items?.[0];
  if (!plItem) {
    return { playlistId, title: "", items: [], error: "Playlist not found" };
  }

  const playlistTitle = sanitizeTitle(plItem.snippet?.title ?? "Playlist");
  const items: YouTubeVideoResult[] = [];
  let nextPage: string | undefined;

  while (items.length < MAX_PLAYLIST_VIDEOS) {
    const url = new URL(`${BASE_URL}/playlistItems`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", apiKey);
    if (nextPage) url.searchParams.set("pageToken", nextPage);

    const res = await fetch(url.toString());
    if (!res.ok) break;

    const data = await res.json();
    const videoIds: string[] = [];
    const snippets = new Map<string, NonNullable<(typeof data.items)[0]>["snippet"]>();

    for (const entry of data.items ?? []) {
      const snippet = entry?.snippet;
      const videoId = snippet?.resourceId?.videoId;
      const title = snippet?.title ?? "";
      if (
        !isValidVideoId(videoId) ||
        title === "Deleted video" ||
        title === "Private video"
      ) {
        continue;
      }
      videoIds.push(videoId);
      snippets.set(videoId, snippet);
    }

    const details = await fetchVideoDetails(videoIds);
    for (const videoId of videoIds) {
      if (items.length >= MAX_PLAYLIST_VIDEOS) break;
      items.push(
        snippetToVideo(
          snippets.get(videoId) ?? {},
          videoId,
          details.get(videoId)?.contentDetails
        )
      );
    }

    nextPage = data.nextPageToken;
    if (!nextPage) break;
  }

  const result: PlaylistResponse = { playlistId, title: playlistTitle, items };
  cacheSet(cacheKey, result);
  return result;
}

export function clearYouTubeCache(): void {
  cache.clear();
}
