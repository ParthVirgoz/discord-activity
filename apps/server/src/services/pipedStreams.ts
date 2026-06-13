import { isValidVideoId } from "../utils/validation";
import { pipedFetch } from "./piped";

interface PipedStream {
  url?: string;
  quality?: string;
  mimeType?: string;
}

interface PipedStreamsResponse {
  duration?: number;
  videoStreams?: PipedStream[];
}

const CACHE_TTL_MS = 20 * 60 * 1000;
const cache = new Map<string, { streamUrl: string; duration: number; expiresAt: number }>();

function isProgressiveMp4(stream: PipedStream): boolean {
  const mime = stream.mimeType ?? "";
  return mime.includes("mp4") && !mime.includes("mpegurl");
}

function streamScore(stream: PipedStream): number {
  const url = stream.url ?? "";
  const quality = stream.quality ?? "";
  let score = 0;

  if (isProgressiveMp4(stream)) score += 100;
  if (/videoplayback|googlevideo|proxy\.piped/i.test(url)) score += 50;
  if (/odycdn|lbry/i.test(url)) score += 10;
  // Prefer 360p/480p — smaller files seek forward faster over Range requests.
  if (/360p|medium/i.test(quality)) score += 40;
  if (/480p/i.test(quality)) score += 32;
  if (/720p/i.test(quality)) score += 18;
  if (/240p|144p|small/i.test(quality)) score += 8;

  return score;
}

function pickVideoStream(streams: PipedStream[]): PipedStream | null {
  const candidates = streams.filter((s) => s.url);
  if (candidates.length === 0) return null;

  const progressive = candidates.filter(isProgressiveMp4);
  const pool = progressive.length > 0 ? progressive : candidates;
  return pool.sort((a, b) => streamScore(b) - streamScore(a))[0] ?? null;
}

export async function resolveVideoPlayback(
  videoId: string
): Promise<{ streamUrl: string; duration: number } | null> {
  if (!isValidVideoId(videoId)) return null;

  const cached = cache.get(videoId);
  if (cached && Date.now() < cached.expiresAt) {
    return { streamUrl: cached.streamUrl, duration: cached.duration };
  }

  const res = await pipedFetch(`/streams/${encodeURIComponent(videoId)}`);
  if (!res) return null;

  let data: PipedStreamsResponse;
  try {
    data = (await res.json()) as PipedStreamsResponse;
  } catch {
    return null;
  }

  const streams = data.videoStreams ?? [];
  const picked = pickVideoStream(streams);
  if (!picked?.url) return null;

  const duration = Math.max(0, Math.floor(data.duration ?? 0));
  cache.set(videoId, {
    streamUrl: picked.url,
    duration,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return { streamUrl: picked.url, duration };
}

/** @deprecated use resolveVideoPlayback */
export const resolvePipedPlayback = resolveVideoPlayback;

export function clearVideoPlaybackCache(): void {
  cache.clear();
}

/** @deprecated */
export const clearPipedPlaybackCache = clearVideoPlaybackCache;
