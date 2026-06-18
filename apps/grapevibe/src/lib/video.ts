import { extractYouTubeId, isYouTubeUrl } from "@/lib/youtube";
import type { VideoItem } from "@/lib/types";

const VIDEO_EXT = /\.(mp4|webm|mov)(\?.*)?$/i;
const URL_PREFIX = /^https?:\/\//i;

export type BrowseInputMode = "empty" | "youtube_url" | "direct_url" | "search";

export function classifyBrowseInput(input: string): BrowseInputMode {
  const trimmed = input.trim();
  if (!trimmed) return "empty";
  if (isYouTubeUrl(trimmed)) return "youtube_url";
  if (isDirectVideoUrl(trimmed)) return "direct_url";
  if (URL_PREFIX.test(trimmed)) {
    if (extractYouTubeId(trimmed)) return "youtube_url";
    if (VIDEO_EXT.test(trimmed)) return "direct_url";
  }
  return "search";
}

export function isDirectVideoUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return false;
  try {
    new URL(trimmed);
    return VIDEO_EXT.test(trimmed);
  } catch {
    return false;
  }
}

export function isVideoInput(input: string): boolean {
  const mode = classifyBrowseInput(input);
  return mode === "youtube_url" || mode === "direct_url";
}

export function parseVideoUrl(
  input: string
): Pick<VideoItem, "source" | "url" | "videoId" | "title" | "mimeType" | "thumbnail"> | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const ytId = extractYouTubeId(trimmed);
  if (ytId) {
    return {
      source: "youtube",
      videoId: ytId,
      title: "YouTube Video",
      thumbnail: `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`,
    };
  }

  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return null;
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname;
    const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
    let mimeType = "video/mp4";
    if (ext === "webm") mimeType = "video/webm";
    else if (ext === "mov") mimeType = "video/quicktime";
    else if (ext === "mp4") mimeType = "video/mp4";
    else if (!VIDEO_EXT.test(trimmed)) return null;

    const filename = pathname.split("/").pop() || "Video";
    const title = decodeURIComponent(filename.replace(/\.[^.]+$/, "")) || "Untitled Video";
    return { source: "direct", url: trimmed, title, mimeType };
  } catch {
    return null;
  }
}

export function buildVideoPayload(
  data: Partial<VideoItem> & { title: string; source: VideoItem["source"] }
): Pick<VideoItem, "source" | "url" | "videoId" | "title" | "mimeType" | "thumbnail"> {
  if (data.source === "youtube" && data.videoId) {
    return {
      source: "youtube",
      videoId: data.videoId,
      title: data.title,
      thumbnail: data.thumbnail ?? `https://i.ytimg.com/vi/${data.videoId}/mqdefault.jpg`,
    };
  }
  return {
    source: "direct",
    url: data.url,
    title: data.title,
    mimeType: data.mimeType ?? "video/mp4",
  };
}
