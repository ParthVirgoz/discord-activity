import { colyseusSDK } from "./Colyseus.js";

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
