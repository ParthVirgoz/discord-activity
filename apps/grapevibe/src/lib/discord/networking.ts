"use client";

import { patchUrlMappings } from "@discord/embedded-app-sdk";
import { isDiscordEmbedded } from "@/lib/discord/sdk";

const SERVER_HOST =
  process.env.NEXT_PUBLIC_SERVER_HOST || "localhost:3000";

/** Map API + Socket.IO to the Grapevibe backend when running inside Discord. */
export function setupDiscordNetworking(): void {
  if (!isDiscordEmbedded) return;

  patchUrlMappings(
    [
      { prefix: "/socket.io", target: SERVER_HOST },
      { prefix: "/api", target: SERVER_HOST },
      { prefix: "/ytimg", target: "i.ytimg.com" },
    ],
    { patchFetch: true, patchWebSocket: true, patchXhr: true, patchSrcAttributes: false }
  );
}
