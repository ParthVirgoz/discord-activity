import { NextResponse } from "next/server";
import { createRoom, roomExists } from "@/server/room-store";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { userId?: string };
    if (!body.userId) {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }
    const room = createRoom(body.userId);
    return NextResponse.json(room);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create room.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.toLowerCase();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return NextResponse.json({ exists: roomExists(id) });
}
