"use client";

import { DISCORD_CLIENT_ID, discordSDK, isDiscordEmbedded } from "@/lib/discord/sdk";
import { apiUrl } from "@/lib/server-url";

export interface DiscordSessionUser {
  id: string;
  username: string;
  avatar: string;
}

export interface DiscordSession {
  token: string;
  user: DiscordSessionUser;
  channelId: string;
}

export async function authenticateDiscord(): Promise<DiscordSession> {
  await discordSDK.ready();

  const channelId = discordSDK.channelId;
  if (!channelId) {
    throw new Error("Join a Discord voice channel, then launch Grapevibe.");
  }

  let code: string;
  if (!isDiscordEmbedded) {
    code = "mock_code";
  } else {
    const result = await discordSDK.commands.authorize({
      client_id: DISCORD_CLIENT_ID,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify", "guilds", "guilds.members.read", "rpc.voice.read"],
    });
    code = result.code;
  }

  let mockUserId: string | undefined;
  if (!isDiscordEmbedded) {
    const params = new URLSearchParams(window.location.search);
    mockUserId =
      params.get("user_id") ??
      sessionStorage.getItem("user_id") ??
      undefined;
  }

  const res = await fetch(apiUrl("/api/discord/token"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, mockUserId }),
  });

  const data = (await res.json()) as {
    access_token?: string;
    token?: string;
    user?: DiscordSessionUser;
    error?: string;
  };

  if (!res.ok || !data.token || !data.user) {
    throw new Error(data.error || "Discord authentication failed.");
  }

  if (isDiscordEmbedded && data.access_token) {
    await discordSDK.commands.authenticate({ access_token: data.access_token });
  }

  return { token: data.token, user: data.user, channelId };
}
