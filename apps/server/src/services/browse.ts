import type { SearchResponse, PlaylistResponse } from "./youtubeShared";
import { searchViaInnertube, importPlaylistViaInnertube } from "./innertube";
import { searchViaInvidious, importPlaylistViaInvidious } from "./invidious";
import { searchViaPiped, importPlaylistViaPiped } from "./piped";

export async function searchYouTubeBrowse(
  query: string,
  pageToken = ""
): Promise<SearchResponse> {
  const providers = [searchViaInnertube, searchViaInvidious, searchViaPiped];
  let lastError: SearchResponse = { items: [], nextPageToken: null };

  for (const provider of providers) {
    const result = await provider(query, pageToken);
    if (result.items.length > 0 || result.nextPageToken) {
      return result;
    }
    if (result.error) lastError = result;
  }

  return lastError.error
    ? lastError
    : { items: [], nextPageToken: null, error: "No videos found. Try another search." };
}

export async function importYouTubeBrowsePlaylist(
  playlistId: string
): Promise<PlaylistResponse> {
  const providers = [
    importPlaylistViaInnertube,
    importPlaylistViaInvidious,
    importPlaylistViaPiped,
  ];
  let lastError: PlaylistResponse = { playlistId, title: "", items: [] };

  for (const provider of providers) {
    const result = await provider(playlistId);
    if (result.items.length > 0) return result;
    if (result.error) lastError = result;
  }

  return lastError;
}
