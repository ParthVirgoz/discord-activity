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
const cache = new Map<string, { streamUrl: string; duration: number; expiresAt: number }>();

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
  if (/videoplayback|googlevideo|proxy\.piped/i.test(url)) score += 50;
  if (/odycdn|lbry/i.test(url)) score += 10;
  if (/360p|medium/i.test(quality)) score += 40;
  if (/480p/i.test(quality)) score += 32;
  if (/720p/i.test(quality)) score += 18;
  if (/240p|144p|small/i.test(quality)) score += 8;

  return score;
}

function pickVideoStream(streams: PipedStream[]): PipedStream | null {
  const candidates = streams.filter((s) => s.url && isProgressiveMp4(s));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => streamScore(b) - streamScore(a))[0] ?? null;
}

async function fetchPipedPlayback(videoId: string): Promise<{ streamUrl: string; duration: number } | null> {
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${base}/streams/${encodeURIComponent(videoId)}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;

      const data = (await res.json()) as PipedStreamsResponse;
      const picked = pickVideoStream(data.videoStreams ?? []);
      if (!picked?.url) continue;

      return {
        streamUrl: picked.url,
        duration: Math.max(0, Math.floor(data.duration ?? 0)),
      };
    } catch {
      /* try next Piped instance */
    }
  }
  return null;
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

  const piped = await fetchPipedPlayback(videoId);
  const resolved = piped ?? (await fetchInvidiousPlayback(videoId));
  if (!resolved) return null;

  cache.set(videoId, {
    streamUrl: resolved.streamUrl,
    duration: resolved.duration,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return resolved;
}

export function invalidateVideoPlaybackCache(videoId: string): void {
  cache.delete(videoId);
}

/** @deprecated use resolveVideoPlayback */
export const resolvePipedPlayback = resolveVideoPlayback;

export function clearVideoPlaybackCache(): void {
  cache.clear();
}

/** @deprecated */
export const clearPipedPlaybackCache = clearVideoPlaybackCache;
