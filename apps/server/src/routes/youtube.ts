import { Router } from "express";
import { Readable } from "node:stream";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { checkRateLimit } from "../utils/rateLimit";
import { isValidVideoId } from "../utils/validation";
import {
  searchVideos,
  importPlaylist,
  sanitizeSearchQuery,
  parsePlaylistId,
} from "../services/youtube";
import { resolveVideoPlayback, invalidateVideoPlaybackCache } from "../services/pipedStreams";

const STREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const router = Router();

router.get("/thumbnail/:videoId", async (req, res) => {
  const videoId = req.params.videoId;
  if (!isValidVideoId(videoId)) {
    res.status(400).end();
    return;
  }

  try {
    const upstream = await fetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

/** Video metadata (duration from Piped) for timeline / queue stats. */
router.get("/info/:videoId", async (req, res) => {
  const videoId = req.params.videoId;
  if (!isValidVideoId(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  const playback = await resolveVideoPlayback(videoId);
  if (!playback) {
    res.status(502).json({ error: "Video info unavailable" });
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json({ durationSec: playback.duration });
});

/** Proxied video stream for Discord (iframe YouTube is CSP-blocked). Supports Range for seeking. */
router.get("/media/:videoId", async (req, res) => {
  const videoId = req.params.videoId;
  if (!isValidVideoId(videoId)) {
    res.status(400).end();
    return;
  }

  const bypassCache = req.query.refresh === "1";
  let playback = await resolveVideoPlayback(videoId, { bypassCache });

  const proxyStream = async (streamUrl: string, duration: number): Promise<boolean> => {
    try {
      const headers: Record<string, string> = {
        "User-Agent": STREAM_USER_AGENT,
        Accept: "*/*",
        Referer: "https://www.youtube.com/",
      };
      const range = req.headers.range;
      if (typeof range === "string") headers.Range = range;

      const upstream = await fetch(streamUrl, {
        headers,
        signal: AbortSignal.timeout(120_000),
        redirect: "follow",
      });

      if (!upstream.ok && upstream.status !== 206) {
        return false;
      }

      res.status(upstream.status);
      const contentType = upstream.headers.get("content-type");
      if (contentType) res.setHeader("Content-Type", contentType);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      res.removeHeader("X-Frame-Options");
      if (duration > 0) {
        res.setHeader("X-Video-Duration-Sec", String(duration));
      }

      for (const h of ["content-range", "content-length"] as const) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }

      if (!upstream.body) {
        return false;
      }

      Readable.fromWeb(upstream.body as import("stream/web").ReadableStream).pipe(res);
      return true;
    } catch {
      return false;
    }
  };

  if (!playback) {
    res.status(502).json({ error: "Video stream unavailable" });
    return;
  }

  const ok = await proxyStream(playback.streamUrl, playback.duration);
  if (ok) return;

  invalidateVideoPlaybackCache(videoId);
  playback = await resolveVideoPlayback(videoId, { bypassCache: true });
  if (!playback) {
    if (!res.headersSent) res.status(502).json({ error: "Video stream unavailable" });
    return;
  }

  const retryOk = await proxyStream(playback.streamUrl, playback.duration);
  if (!retryOk && !res.headersSent) {
    res.status(502).json({ error: "Video stream unavailable" });
  }
});

const SEARCH_LIMIT = 20;
const SEARCH_WINDOW_MS = 60_000;
const PLAYLIST_LIMIT = 5;
const PLAYLIST_WINDOW_MS = 60_000;

router.get("/search", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  if (!checkRateLimit(`search:${userId}`, SEARCH_LIMIT, SEARCH_WINDOW_MS)) {
    res.status(429).json({ error: "Too many search requests. Try again later." });
    return;
  }

  const query = sanitizeSearchQuery(req.query.q);
  if (query.length < 2) {
    res.status(400).json({ error: "Search query must be at least 2 characters" });
    return;
  }

  const pageToken =
    typeof req.query.pageToken === "string" ? req.query.pageToken.slice(0, 128) : "";

  const result = await searchVideos(query, pageToken);
  if (result.error && result.items.length === 0) {
    res.status(result.error.includes("not found") ? 404 : 503).json({ error: result.error });
    return;
  }

  res.json(result);
});

router.get("/playlist", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  if (!checkRateLimit(`playlist:${userId}`, PLAYLIST_LIMIT, PLAYLIST_WINDOW_MS)) {
    res.status(429).json({ error: "Too many playlist imports. Try again later." });
    return;
  }

  const playlistId = parsePlaylistId(
    typeof req.query.list === "string" ? req.query.list : req.query.url
  );
  if (!playlistId) {
    res.status(400).json({ error: "Invalid playlist URL or ID" });
    return;
  }

  const result = await importPlaylist(playlistId);
  if (result.error && result.items.length === 0) {
    res.status(404).json({ error: result.error });
    return;
  }

  res.json(result);
});

export default router;
