import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { checkRateLimit } from "../utils/rateLimit";
import { isValidVideoId } from "../utils/validation";
import {
  searchVideos,
  importPlaylist,
  sanitizeSearchQuery,
  parsePlaylistId,
} from "../services/youtube";

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
