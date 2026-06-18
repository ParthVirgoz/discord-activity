import { NextResponse } from "next/server";
import { searchYouTubeNoApi } from "@/lib/youtube-search";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json({ error: "Enter at least 2 characters." }, { status: 400 });
  }

  try {
    const items = await searchYouTubeNoApi(q);
    if (items.length === 0) {
      return NextResponse.json({
        items: [],
        error: "No results found. Try different keywords or paste a YouTube URL.",
      });
    }
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json(
      {
        items: [],
        error: "Search temporarily unavailable. Paste a YouTube link instead.",
      },
      { status: 503 }
    );
  }
}
