import { isValidVideoId } from "../utils/validation";
import { PIPED_INSTANCES } from "./pipedInstances";
import { invidiousFetch } from "./invidious";

interface PipedStream {
  url?: string;
  quality?: string;
  mimeType?: string;
}

interface PipedStreamsResponse {
  duration?: number;
  videoStreams?: PipedStream[];
}

interface InvidiousFormat {
  url?: string;
  quality?: string;
  type?: string;
  container?: string;
}

interface InvidiousVideoResponse {
  lengthSeconds?: number;
  formatStreams?: InvidiousFormat[];
}

const CACHE_TTL_MS = 20 * 60 * 1000;
const cache = new Map<
  string,
  {
    streamUrl: string;
    duration: number;
    candidates?: { streamUrl: string; duration: number }[];
    expiresAt: number;
  }
>();

function isProgressiveMp4(stream: { mimeType?: string; type?: string; container?: string }): boolean {
  const mime = stream.mimeType ?? stream.type ?? "";
  const container = stream.container ?? "";
  if (mime.includes("mpegurl") || mime.includes("mp2t")) return false;
  return mime.includes("mp4") || container === "mp4";
}

function streamScore(stream: PipedStream): number {
  const url = stream.url ?? "";
  const quality = stream.quality ?? "";
  let score = 0;

  if (isProgressiveMp4(stream)) score += 100;
  // Piped proxy needs Referer: piped.video — prefer when reachable; LBRY is a solid fallback.
  if (/odycdn|lbry/i.test(url)) score += 70;
  if (/proxy\.piped|piped\.private/i.test(url)) score += 55;
  if (/videoplayback|googlevideo/i.test(url) && !/proxy\.piped/i.test(url)) score += 45;
  if (/360p|medium/i.test(quality)) score += 40;
  if (/480p/i.test(quality)) score += 32;
  if (/720p/i.test(quality)) score += 18;
  if (/240p|144p|small/i.test(quality)) score += 8;

  return score;
}

function pickVideoStreams(streams: PipedStream[]): PipedStream[] {
  return streams
    .filter((s) => s.url && isProgressiveMp4(s))
    .sort((a, b) => streamScore(b) - streamScore(a));
}

function pickVideoStream(streams: PipedStream[]): PipedStream | null {
  return pickVideoStreams(streams)[0] ?? null;
}

/** Upstream Referer required by Piped proxy / LBRY CDN (wrong Referer → 403). */
export function refererForStreamUrl(streamUrl: string): string {
  if (/proxy\.piped|piped\.private|piped\.video/i.test(streamUrl)) {
    return "https://piped.video/";
  }
  if (/odycdn|lbry|odysee/i.test(streamUrl)) {
    return "https://odysee.com/";
  }
  return "https://www.youtube.com/";
}

async function fetchPipedPlayback(videoId: string): Promise<{ streamUrl: string; duration: number } | null> {
  const candidates = await fetchPipedPlaybackCandidates(videoId);
  return candidates[0] ?? null;
}

async function fetchPipedPlaybackCandidates(
  videoId: string
): Promise<{ streamUrl: string; duration: number }[]> {
  const results: { streamUrl: string; duration: number }[] = [];

  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${base}/streams/${encodeURIComponent(videoId)}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;

      const data = (await res.json()) as PipedStreamsResponse;
      const duration = Math.max(0, Math.floor(data.duration ?? 0));
      const picked = pickVideoStreams(data.videoStreams ?? []);

      for (const stream of picked) {
        if (!stream.url) continue;
        results.push({ streamUrl: stream.url, duration });
      }

      if (results.length > 0) return results;
    } catch {
      /* try next Piped instance */
    }
  }
  return results;
}

async function fetchInvidiousPlayback(videoId: string): Promise<{ streamUrl: string; duration: number } | null> {
  const res = await invidiousFetch(`/api/v1/videos/${encodeURIComponent(videoId)}`);
  if (!res) return null;

  let data: InvidiousVideoResponse;
  try {
    data = (await res.json()) as InvidiousVideoResponse;
  } catch {
    return null;
  }

  const streams: PipedStream[] = (data.formatStreams ?? []).map((f) => ({
    url: f.url,
    quality: f.quality,
    mimeType: f.type,
  }));

  const picked = pickVideoStream(streams);
  if (!picked?.url) return null;

  return {
    streamUrl: picked.url,
    duration: Math.max(0, Math.floor(data.lengthSeconds ?? 0)),
  };
}

export async function resolveVideoPlaybackCandidates(
  videoId: string,
  options: { bypassCache?: boolean } = {}
): Promise<{ streamUrl: string; duration: number }[]> {
  if (!isValidVideoId(videoId)) return [];

  const cacheKey = `candidates:${videoId}`;
  if (!options.bypassCache) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.candidates;
    }
  }

  const seen = new Set<string>();
  const candidates: { streamUrl: string; duration: number }[] = [];

  const add = (entry: { streamUrl: string; duration: number } | null) => {
    if (!entry?.streamUrl || seen.has(entry.streamUrl)) return;
    seen.add(entry.streamUrl);
    candidates.push(entry);
  };

  for (const entry of await fetchPipedPlaybackCandidates(videoId)) {
    add(entry);
  }
  add(await fetchInvidiousPlayback(videoId));

  if (candidates.length > 0) {
    cache.set(cacheKey, {
      streamUrl: candidates[0].streamUrl,
      duration: candidates[0].duration,
      candidates,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  return candidates;
}

export async function resolveVideoPlayback(
  videoId: string,
  options: { bypassCache?: boolean } = {}
): Promise<{ streamUrl: string; duration: number } | null> {
  if (!isValidVideoId(videoId)) return null;

  if (!options.bypassCache) {
    const cached = cache.get(videoId);
    if (cached && Date.now() < cached.expiresAt) {
      return { streamUrl: cached.streamUrl, duration: cached.duration };
    }
  }

  const candidates = await resolveVideoPlaybackCandidates(videoId, options);
  const resolved = candidates[0] ?? null;
  if (!resolved) return null;

  cache.set(videoId, {
    streamUrl: resolved.streamUrl,
    duration: resolved.duration,
    candidates,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return resolved;
}

export function invalidateVideoPlaybackCache(videoId: string): void {
  cache.delete(videoId);
  cache.delete(`candidates:${videoId}`);
}

/** @deprecated use resolveVideoPlayback */
export const resolvePipedPlayback = resolveVideoPlayback;

export function clearVideoPlaybackCache(): void {
  cache.clear();
}

/** @deprecated */
export const clearPipedPlaybackCache = clearVideoPlaybackCache;
