import { isValidVideoId, sanitizeTitle } from "../utils/validation";
import {
  formatDuration,
  youtubeThumbUrl,
  type YouTubeVideoResult,
  type SearchResponse,
  type PlaylistResponse,
} from "./youtubeShared";

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_SIZE = 256;
const SEARCH_PAGE_SIZE = 24;
const MAX_PLAYLIST_VIDEOS = 50;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

let innertubeApiKey: string | null = null;
let innertubeClientVersion: string | null = null;

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

function youtubeThumb(videoId: string): string {
  return youtubeThumbUrl(videoId);
}

function parseDurationLabel(label: unknown): string {
  if (typeof label !== "string") return "";
  return label.replace(/\s+/g, " ").trim();
}

async function getInnertubeConfig(): Promise<{ apiKey: string; clientVersion: string }> {
  if (innertubeApiKey && innertubeClientVersion) {
    return { apiKey: innertubeApiKey, clientVersion: innertubeClientVersion };
  }

  try {
    const res = await fetch("https://www.youtube.com/", {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const versionMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
    innertubeApiKey = apiKeyMatch?.[1] ?? "AIzaSyAO_FJ2SlqU8Q4STWHHLq9f_Y0zhcQOffice";
    innertubeClientVersion = versionMatch?.[1] ?? "2.20240101.00.00";
  } catch {
    innertubeApiKey = "AIzaSyAO_FJ2SlqU8Q4STWHHLq9f_Y0zhcQOffice";
    innertubeClientVersion = "2.20240101.00.00";
  }

  return { apiKey: innertubeApiKey, clientVersion: innertubeClientVersion };
}

function parseTextRuns(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  const runs = (obj as { runs?: { text?: string }[] }).runs;
  if (Array.isArray(runs)) {
    return runs.map((r) => r.text ?? "").join("").trim();
  }
  const simple = (obj as { simpleText?: string }).simpleText;
  return typeof simple === "string" ? simple.trim() : "";
}

function extractVideosFromInnertube(data: unknown): YouTubeVideoResult[] {
  const items: YouTubeVideoResult[] = [];
  const root = data as Record<string, unknown>;

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || items.length >= SEARCH_PAGE_SIZE) return;

    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }

    const obj = node as Record<string, unknown>;
    const vr = obj.videoRenderer as Record<string, unknown> | undefined;
    if (vr && typeof vr.videoId === "string" && isValidVideoId(vr.videoId)) {
      const videoId = vr.videoId;
      const durationLabel =
        parseDurationLabel(parseTextRuns(vr.lengthText)) ||
        parseDurationLabel(
          (vr.lengthText as { accessibility?: { accessibilityData?: { label?: string } } })
            ?.accessibility?.accessibilityData?.label
        );

      items.push({
        videoId,
        title: sanitizeTitle(parseTextRuns(vr.title) || "Unknown"),
        channel: sanitizeTitle(
          parseTextRuns(vr.ownerText) || parseTextRuns(vr.longBylineText) || ""
        ),
        thumbnail: youtubeThumb(videoId),
        duration: durationLabel,
      });
    }

    for (const value of Object.values(obj)) {
      if (items.length >= SEARCH_PAGE_SIZE) break;
      walk(value);
    }
  };

  walk(root);
  return items;
}

function extractContinuationToken(data: unknown): string | null {
  const tokens: string[] = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const obj = node as Record<string, unknown>;
    const cont = obj.continuationItemRenderer as
      | { continuationEndpoint?: { continuationCommand?: { token?: string } } }
      | undefined;
    const token = cont?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token.length > 0) tokens.push(token);

    const next = obj.nextContinuationData as { continuation?: string } | undefined;
    if (typeof next?.continuation === "string") tokens.push(next.continuation);

    for (const value of Object.values(obj)) walk(value);
  };

  walk(data);
  return tokens[0] ?? null;
}

export async function searchViaInnertube(query: string, pageToken = ""): Promise<SearchResponse> {
  const cacheKey = `innertube:search:${query}:${pageToken}`;
  const cached = cacheGet<SearchResponse>(cacheKey);
  if (cached) return cached;

  try {
    const { apiKey, clientVersion } = await getInnertubeConfig();
    const endpoint = pageToken
      ? `https://www.youtube.com/youtubei/v1/search?prettyPrint=false&key=${encodeURIComponent(apiKey)}`
      : `https://www.youtube.com/youtubei/v1/search?prettyPrint=false&key=${encodeURIComponent(apiKey)}`;

    const body: Record<string, unknown> = {
      context: {
        client: {
          clientName: "WEB",
          clientVersion,
          hl: "en",
          gl: "US",
        },
      },
    };

    if (pageToken) {
      body.continuation = pageToken;
    } else {
      body.query = query;
      body.params = "EgIQAQ==";
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return { items: [], nextPageToken: null, error: "YouTube search failed" };
    }

    const data = await res.json();
    const items = extractVideosFromInnertube(data);
    const nextPageToken = extractContinuationToken(data);

    const result: SearchResponse = { items, nextPageToken };
    if (items.length > 0) cacheSet(cacheKey, result);
    return result;
  } catch {
    return { items: [], nextPageToken: null, error: "YouTube search unavailable" };
  }
}

function parsePlaylistVideos(data: unknown): YouTubeVideoResult[] {
  const items: YouTubeVideoResult[] = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || items.length >= MAX_PLAYLIST_VIDEOS) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }

    const obj = node as Record<string, unknown>;
    const pr =
      (obj.playlistVideoRenderer as Record<string, unknown> | undefined) ??
      (obj.gridVideoRenderer as Record<string, unknown> | undefined);

    if (pr) {
      const videoId =
        (typeof pr.videoId === "string" ? pr.videoId : null) ??
        (pr.videoId as { videoId?: string } | undefined)?.videoId;
      if (videoId && isValidVideoId(videoId)) {
        items.push({
          videoId,
          title: sanitizeTitle(parseTextRuns(pr.title) || "Unknown"),
          channel: sanitizeTitle(parseTextRuns(pr.shortBylineText) || ""),
          thumbnail: youtubeThumb(videoId),
          duration: parseDurationLabel(parseTextRuns(pr.lengthText)),
        });
      }
    }

    for (const value of Object.values(obj)) {
      if (items.length >= MAX_PLAYLIST_VIDEOS) break;
      walk(value);
    }
  };

  walk(data);
  return items;
}

export async function importPlaylistViaInnertube(playlistId: string): Promise<PlaylistResponse> {
  const cacheKey = `innertube:playlist:${playlistId}`;
  const cached = cacheGet<PlaylistResponse>(cacheKey);
  if (cached) return cached;

  try {
    const { apiKey, clientVersion } = await getInnertubeConfig();
    const browseId = playlistId.startsWith("VL") ? playlistId : `VL${playlistId}`;
    const url = `https://www.youtube.com/youtubei/v1/browse?prettyPrint=false&key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        context: {
          client: { clientName: "WEB", clientVersion, hl: "en", gl: "US" },
        },
        browseId,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return { playlistId, title: "", items: [], error: "Playlist lookup failed" };
    }

    const data = await res.json();
    const items = parsePlaylistVideos(data);
    const title =
      sanitizeTitle(
        parseTextRuns(
          (data as { header?: { playlistHeaderRenderer?: { title?: unknown } } })?.header
            ?.playlistHeaderRenderer?.title
        )
      ) || "Playlist";

    const result: PlaylistResponse = {
      playlistId,
      title,
      items,
      error: items.length === 0 ? "Playlist is empty or private" : undefined,
    };
    if (items.length > 0) cacheSet(cacheKey, result);
    return result;
  } catch {
    return { playlistId, title: "", items: [], error: "Playlist lookup failed" };
  }
}

export function durationLabelToSeconds(label: string): number {
  if (!label) return 0;
  const parts = label.split(":").map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}
