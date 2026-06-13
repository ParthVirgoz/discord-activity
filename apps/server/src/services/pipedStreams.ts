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

function pickVideoStream(streams: PipedStream[]): PipedStream | null {
  const mp4 = streams.filter((s) => s.mimeType?.includes("mp4") || s.url?.includes("mp4"));
  const pool = mp4.length > 0 ? mp4 : streams;
  const preferred =
    pool.find((s) => /360p|480p|720p|medium/i.test(s.quality ?? "")) ?? pool[0];
  return preferred ?? null;
}

export async function resolvePipedPlayback(
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

export function clearPipedPlaybackCache(): void {
  cache.clear();
}
