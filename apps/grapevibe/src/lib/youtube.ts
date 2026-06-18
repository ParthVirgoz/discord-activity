const YT_HOSTS = /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i;

export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (!YT_HOSTS.test(url.hostname)) return null;

    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.slice(1).split("/")[0];
      return id.length === 11 ? id : null;
    }

    const v = url.searchParams.get("v");
    if (v && v.length === 11) return v;

    const embed = url.pathname.match(/\/embed\/([\w-]{11})/);
    if (embed) return embed[1];

    const shorts = url.pathname.match(/\/shorts\/([\w-]{11})/);
    if (shorts) return shorts[1];
  } catch {
    return null;
  }
  return null;
}

export function isYouTubeUrl(input: string): boolean {
  return extractYouTubeId(input) !== null;
}

export function youtubeThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
