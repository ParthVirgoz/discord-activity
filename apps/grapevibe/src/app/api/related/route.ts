import { NextResponse } from "next/server";
import { relatedYouTubeNoApi, searchYouTubeNoApi } from "@/lib/youtube-search";

const VIDEO_ID_RE = /^[\w-]{11}$/;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("videoId")?.trim() ?? "";
  const title = searchParams.get("title")?.trim() || undefined;
  const channel = searchParams.get("channel")?.trim() || undefined;

  if (!VIDEO_ID_RE.test(videoId)) {
    return NextResponse.json({ items: [] });
  }

  let items = await relatedYouTubeNoApi(videoId, title, channel);

  if (items.length === 0) {
    const q = channel || title?.split(/[|\-–—(]/)[0]?.trim() || "music";
    try {
      items = (await searchYouTubeNoApi(q)).filter((v) => v.videoId !== videoId).slice(0, 15);
    } catch {
      items = [];
    }
  }

  return NextResponse.json({ items });
}
