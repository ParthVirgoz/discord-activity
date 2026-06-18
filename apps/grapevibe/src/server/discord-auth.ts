import { SignJWT, jwtVerify } from "jose";

export interface DiscordAuthUser {
  id: string;
  username: string;
  avatar: string;
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production");
  }
  return new TextEncoder().encode(secret || "grapevibe-dev-secret");
}

export async function signDiscordUser(user: DiscordAuthUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(jwtSecret());
}

export async function verifyDiscordToken(token: string): Promise<DiscordAuthUser> {
  const { payload } = await jwtVerify(token, jwtSecret());
  const id = typeof payload.id === "string" ? payload.id : "";
  const username = typeof payload.username === "string" ? payload.username : "Guest";
  const avatar = typeof payload.avatar === "string" ? payload.avatar : "";
  if (!id) throw new Error("Invalid token");
  return { id, username, avatar };
}

const CHANNEL_ID_REGEX = /^\d{17,20}$/;

export function isValidChannelId(channelId: unknown): channelId is string {
  return typeof channelId === "string" && CHANNEL_ID_REGEX.test(channelId);
}

export function sanitizeUsername(username: unknown): string {
  if (typeof username !== "string" || !username.trim()) return "Guest";
  return username.trim().slice(0, 32);
}

export async function exchangeDiscordCode(
  code: string,
  mockUserId?: string
): Promise<{
  access_token: string;
  user: DiscordAuthUser;
}> {
  if (process.env.NODE_ENV !== "production" && code === "mock_code") {
    const id =
      mockUserId && /^\d{17,20}$/.test(mockUserId)
        ? mockUserId
        : Math.random().toString().slice(2, 20);
    return {
      access_token: "mocked",
      user: { id, username: `Dev ${id.slice(0, 6)}`, avatar: "" },
    };
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Server misconfigured");
  }

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error("Discord token exchange failed");
  }

  const profileRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = (await profileRes.json()) as { id?: string; username?: string; avatar?: string };
  if (!profileRes.ok || !profile.id) {
    throw new Error("Failed to fetch Discord profile");
  }

  return {
    access_token: tokenData.access_token,
    user: {
      id: profile.id,
      username: sanitizeUsername(profile.username),
      avatar: profile.avatar ?? "",
    },
  };
}
