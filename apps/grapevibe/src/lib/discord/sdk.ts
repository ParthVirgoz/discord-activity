"use client";

import { DiscordSDK, DiscordSDKMock } from "@discord/embedded-app-sdk";

export const DISCORD_CLIENT_ID = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID ?? "";

const queryParams = new URLSearchParams(
  typeof window !== "undefined" ? window.location.search : ""
);
export const isDiscordEmbedded = queryParams.get("frame_id") != null;

let discordSDK: DiscordSDK | DiscordSDKMock;

if (typeof window === "undefined") {
  discordSDK = null as unknown as DiscordSDK;
} else if (isDiscordEmbedded) {
  discordSDK = new DiscordSDK(DISCORD_CLIENT_ID);
} else {
  enum SessionStorageQueryParam {
    user_id = "user_id",
    guild_id = "guild_id",
    channel_id = "channel_id",
  }

  function getOverrideOrRandomSessionValue(queryParam: `${SessionStorageQueryParam}`) {
    const overrideValue = queryParams.get(queryParam);
    if (overrideValue != null) return overrideValue;
    const stored = sessionStorage.getItem(queryParam);
    if (stored != null) return stored;
    const snowflake = String(Math.floor(1e17 + Math.random() * 9e17));
    sessionStorage.setItem(queryParam, snowflake);
    return snowflake;
  }

  const mockUserId = getOverrideOrRandomSessionValue("user_id");
  const mockGuildId = getOverrideOrRandomSessionValue("guild_id");
  const mockChannelId = getOverrideOrRandomSessionValue("channel_id");

  discordSDK = new DiscordSDKMock(DISCORD_CLIENT_ID, mockGuildId, mockChannelId, "en");
  const discriminator = String(mockUserId.charCodeAt(0) % 5);
  discordSDK._updateCommandMocks({
    authenticate: async () => ({
      access_token: "mock_token",
      user: {
        username: mockUserId,
        discriminator,
        id: mockUserId,
        avatar: null,
        public_flags: 1,
      },
      scopes: [],
      expires: new Date(2112, 1, 1).toString(),
      application: {
        description: "Grapevibe",
        icon: "mock_app_icon",
        id: "mock_app_id",
        name: "Grapevibe",
      },
    }),
  });
}

export { discordSDK };

export function discordAvatarUrl(userId: string, avatar: string | null | undefined, size = 64) {
  if (avatar) {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=${size}`;
  }
  const index = Number(BigInt(userId) % BigInt(6));
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
