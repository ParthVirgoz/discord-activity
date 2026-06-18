import { NextResponse } from "next/server";
import { roomExists } from "@/server/room-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  if (!roomId) return NextResponse.json({ error: "Missing room id" }, { status: 400 });
  return NextResponse.json({ exists: roomExists(roomId) });
}
