import { colyseusSDK } from "./Colyseus.js";
import { getServerProxyPrefix } from "./discordUrls.js";

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

async function apiGet<T>(path: string): Promise<T> {
  const token = colyseusSDK.auth.token;
  if (!token) throw new Error("Not authenticated");

  const { data, status } = await colyseusSDK.http.get(path, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (status >= 400) {
    const message = typeof data?.error === "string" ? data.error : "Request failed";
    throw new Error(message);
  }

  return data as T;
}

export async function searchYouTube(query: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  return apiGet<SearchResponse>(`/api/youtube/search?${params}`);
}

export async function importYouTubePlaylist(
  listOrUrl: string
): Promise<PlaylistResponse> {
  const params = new URLSearchParams();
  if (listOrUrl.includes("youtube.com") || listOrUrl.includes("youtu.be")) {
    params.set("url", listOrUrl);
  } else {
    params.set("list", listOrUrl);
  }
  return apiGet<PlaylistResponse>(`/api/youtube/playlist?${params}`);
}

export async function fetchVideoDurationSec(videoId: string): Promise<number> {
  try {
    const url = `${getServerProxyPrefix()}/api/youtube/info/${encodeURIComponent(videoId)}`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const data = (await res.json()) as { durationSec?: number };
    return typeof data.durationSec === "number" && data.durationSec > 0
      ? Math.floor(data.durationSec)
      : 0;
  } catch {
    return 0;
  }
}
