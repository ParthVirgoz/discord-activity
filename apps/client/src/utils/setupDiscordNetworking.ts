import { patchUrlMappings } from "@discord/embedded-app-sdk";
import { isEmbedded } from "./DiscordSDK.js";

/** Backend host for Discord URL mapping `/colyseus` → server. */
const SERVER_HOST =
  import.meta.env.VITE_SERVER_HOST || "discord-activity.up.railway.app";

/**
 * Rewrites external fetch/WebSocket/img/iframe requests to Discord-mapped paths.
 * Prefixes must NOT contain `.proxy` — Discord adds routing automatically.
 */
export function setupDiscordNetworking(): void {
  if (!isEmbedded) return;

  patchUrlMappings(
    [
      { prefix: "/colyseus", target: SERVER_HOST },
      { prefix: "/youtube-nocookie", target: "www.youtube-nocookie.com" },
      { prefix: "/ytimg", target: "i.ytimg.com" },
    ],
    { patchSrcAttributes: true }
  );
}
