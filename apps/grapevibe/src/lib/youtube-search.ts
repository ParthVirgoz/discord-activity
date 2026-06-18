import type { SearchResultItem } from "@/lib/types";
import {
  buildEmergencyQueries,
  buildSimilarityQueries,
  filterRelatedCandidates,
  filterRelaxed,
  mergeAndRankSimilar,
  RELATED_MAX_RESULTS,
  rankBySimilarity,
  type VideoSignals,
} from "@/lib/related-videos";

const PIPED_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.darkness.services",
  "https://api.piped.yt",
  "https://pipedapi.nosebs.ru",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi-libre.kavin.rocks",
  "https://api.piped.projectsegfau.lt",
  "https://pipedapi.adminforge.de",
];

const INVIDIOUS_INSTANCES = [
  "https://invidious.privacydev.net",
  "https://vid.puffyan.us",
  "https://invidious.protokolla.fi",
  "https://invidious.io.lol",
  "https://inv.nadeko.net",
];

const MAX_RESULTS = 15;
const VIDEO_ID_RE = /^[\w-]{11}$/;

function isValidVideoId(id: string): boolean {
  return VIDEO_ID_RE.test(id);
}

function extractVideoIdFromUrl(url: string): string | null {
  if (!url) return null;
  if (isValidVideoId(url)) return url;

  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/([a-zA-Z0-9_-]{11})(?:[/?&]|$)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    const id = match?.[1];
    if (id && isValidVideoId(id)) return id;
  }
  return null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function thumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function pipedFetch(path: string, timeoutMs = 18_000): Promise<Response | null> {
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetchWithTimeout(
        `${base}${path}`,
        { headers: { Accept: "application/json" } },
        timeoutMs
      );
      if (res.ok) return res;
    } catch {
      // try next instance
    }
  }
  return null;
}

interface PipedItem {
  type?: string;
  url?: string;
  title?: string;
  thumbnail?: string;
  uploaderName?: string;
  duration?: number;
}

function pipedItemToResult(item: PipedItem): SearchResultItem | null {
  const videoId = extractVideoIdFromUrl(item.url ?? "");
  if (!videoId || !item.title) return null;
  const durationSec = typeof item.duration === "number" && item.duration > 0 ? item.duration : 0;
  return {
    videoId,
    title: item.title.slice(0, 200),
    thumbnail: thumb(videoId),
    duration: durationSec > 0 ? formatDuration(durationSec) : undefined,
    channel: item.uploaderName?.slice(0, 80),
  };
}

async function searchViaPiped(query: string): Promise<SearchResultItem[]> {
  const params = new URLSearchParams({ q: query, filter: "videos" });
  const res = await pipedFetch(`/search?${params}`, 18_000);
  if (!res) return [];

  const data = (await res.json()) as { items?: PipedItem[] };
  const items: SearchResultItem[] = [];
  for (const entry of data.items ?? []) {
    if (entry.type && entry.type !== "stream") continue;
    const video = pipedItemToResult(entry);
    if (video) items.push(video);
    if (items.length >= MAX_RESULTS) break;
  }
  return items;
}

async function invidiousFetch(path: string, timeoutMs = 12_000): Promise<Response | null> {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetchWithTimeout(
        `${base}${path}`,
        { headers: { Accept: "application/json" } },
        timeoutMs
      );
      if (res.ok) return res;
    } catch {
      // try next instance
    }
  }
  return null;
}

interface InvidiousItem {
  type?: string;
  videoId?: string;
  title?: string;
  author?: string;
  lengthSeconds?: number;
}

function invidiousItemToResult(entry: InvidiousItem): SearchResultItem | null {
  if (!entry.videoId || !isValidVideoId(entry.videoId) || !entry.title) return null;
  const durationSec =
    typeof entry.lengthSeconds === "number" ? entry.lengthSeconds : 0;
  return {
    videoId: entry.videoId,
    title: entry.title.slice(0, 200),
    thumbnail: thumb(entry.videoId),
    duration: durationSec > 0 ? formatDuration(durationSec) : undefined,
    channel: entry.author?.slice(0, 80),
  };
}

async function searchViaInvidious(query: string): Promise<SearchResultItem[]> {
  const params = new URLSearchParams({ q: query, type: "video", page: "1" });
  const res = await invidiousFetch(`/api/v1/search?${params}`);
  if (!res) return [];

  const data = (await res.json()) as InvidiousItem[];
  const items: SearchResultItem[] = [];
  for (const entry of data) {
    if (entry.type && entry.type !== "video") continue;
    const video = invidiousItemToResult(entry);
    if (video) items.push(video);
    if (items.length >= MAX_RESULTS) break;
  }
  return items;
}

export async function searchYouTubeNoApi(query: string): Promise<SearchResultItem[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const piped = await searchViaPiped(trimmed);
  if (piped.length > 0) return piped;

  const invidious = await searchViaInvidious(trimmed);
  if (invidious.length > 0) return invidious;

  return [];
}

interface PipedStreamPayload {
  title?: string;
  uploader?: string;
  uploaderName?: string;
  category?: string;
  tags?: string[];
  relatedStreams?: PipedItem[];
}

export interface StreamMetadata {
  items: SearchResultItem[];
  signals: VideoSignals;
}

async function fetchStreamMetadata(videoId: string): Promise<StreamMetadata> {
  const empty: StreamMetadata = {
    items: [],
    signals: { videoId, title: "" },
  };
  if (!isValidVideoId(videoId)) return empty;

  const res = await pipedFetch(`/streams/${videoId}`, 30_000);
  if (!res) return empty;

  const data = (await res.json()) as PipedStreamPayload;
  const channel = data.uploaderName || data.uploader;
  const items: SearchResultItem[] = [];

  for (const entry of data.relatedStreams ?? []) {
    if (entry.type && entry.type !== "stream") continue;
    const video = pipedItemToResult(entry);
    if (video) items.push(video);
    if (items.length >= MAX_RESULTS * 3) break;
  }

  return {
    items,
    signals: {
      videoId,
      title: data.title ?? "",
      channel,
      tags: Array.isArray(data.tags) ? data.tags : [],
      category: data.category,
    },
  };
}

async function relatedViaInvidious(videoId: string): Promise<SearchResultItem[]> {
  if (!isValidVideoId(videoId)) return [];
  const res = await invidiousFetch(`/api/v1/videos/${videoId}`, 15_000);
  if (!res) return [];

  const data = (await res.json()) as { recommendedVideos?: InvidiousItem[] };
  const items: SearchResultItem[] = [];
  for (const entry of data.recommendedVideos ?? []) {
    const video = invidiousItemToResult(entry);
    if (video) items.push(video);
    if (items.length >= MAX_RESULTS * 2) break;
  }
  return items;
}

function buildSignals(
  videoId: string,
  stream: StreamMetadata,
  titleHint?: string,
  channelHint?: string
): VideoSignals {
  return {
    videoId,
    title: (titleHint || stream.signals.title || "").trim(),
    channel: channelHint?.trim() || stream.signals.channel,
    tags: stream.signals.tags,
    category: stream.signals.category,
  };
}

async function supplementFromMetadata(signals: VideoSignals): Promise<SearchResultItem[]> {
  const queries = buildSimilarityQueries(signals);
  const batches: SearchResultItem[][] = [];

  for (const query of queries.slice(0, 5)) {
    const items = await searchYouTubeNoApi(query);
    if (items.length > 0) batches.push(items);
    const merged = mergeAndRankSimilar(signals, batches);
    if (merged.length >= RELATED_MAX_RESULTS) return merged;
  }

  return mergeAndRankSimilar(signals, batches);
}

async function emergencySearch(signals: VideoSignals): Promise<SearchResultItem[]> {
  const queries = [
    ...buildSimilarityQueries(signals),
    ...buildEmergencyQueries(signals),
  ];
  const unique = [...new Set(queries.map((q) => q.toLowerCase()))];

  for (const query of unique.slice(0, 8)) {
    try {
      const items = await searchYouTubeNoApi(query);
      const relaxed = filterRelaxed(signals, items);
      if (relaxed.length > 0) {
        return rankBySimilarity(signals, relaxed).slice(0, RELATED_MAX_RESULTS);
      }
    } catch {
      // try next query
    }
  }
  return [];
}

/**
 * Similar songs for what's playing — always tries hard to return something.
 */
export async function relatedYouTubeNoApi(
  videoId: string,
  titleHint?: string,
  channelHint?: string
): Promise<SearchResultItem[]> {
  const id = videoId.trim();
  if (!isValidVideoId(id)) return [];

  try {
    const stream = await fetchStreamMetadata(id);
    const signals = buildSignals(id, stream, titleHint, channelHint);

    let invidious: SearchResultItem[] = [];
    try {
      invidious = await relatedViaInvidious(id);
    } catch {
      // optional source
    }

    const rawPool = [...stream.items, ...invidious];

    let result = rankBySimilarity(
      signals,
      filterRelatedCandidates(signals, rawPool)
    );

    if (result.length < RELATED_MAX_RESULTS) {
      const supplemented = await supplementFromMetadata(signals);
      result = mergeAndRankSimilar(signals, [result, supplemented]);
    }

    if (result.length > 0) {
      return result.slice(0, RELATED_MAX_RESULTS);
    }

    result = rankBySimilarity(signals, filterRelaxed(signals, rawPool));
    if (result.length > 0) {
      return result.slice(0, RELATED_MAX_RESULTS);
    }

    const emergency = await emergencySearch(signals);
    if (emergency.length > 0) return emergency;

    const lastQuery =
      signals.channel?.trim() ||
      signals.title.split(/[|\-–—(]/)[0]?.trim() ||
      titleHint?.trim() ||
      "music";
    const last = filterRelaxed(signals, await searchYouTubeNoApi(lastQuery));
    return rankBySimilarity(signals, last).slice(0, RELATED_MAX_RESULTS);
  } catch {
    const q = channelHint?.trim() || titleHint?.trim() || "music";
    try {
      const items = await searchYouTubeNoApi(q);
      return items.filter((v) => v.videoId !== id).slice(0, RELATED_MAX_RESULTS);
    } catch {
      return [];
    }
  }
}
