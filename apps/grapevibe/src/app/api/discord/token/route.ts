import { NextResponse } from "next/server";
import { exchangeDiscordCode, signDiscordUser } from "@/server/discord-auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { code?: string; mockUserId?: string };
    if (typeof body.code !== "string" || body.code.length > 512) {
      return NextResponse.json({ error: "Invalid authorization code." }, { status: 400 });
    }

    const { access_token, user } = await exchangeDiscordCode(body.code, body.mockUserId);
    const token = await signDiscordUser(user);

    return NextResponse.json({
      access_token,
      token,
      user,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Authentication failed.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
