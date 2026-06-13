import { patchUrlMappings } from "@discord/embedded-app-sdk";
import { isEmbedded } from "./DiscordSDK.js";

/** Backend host for Discord URL mappings (Developer Portal → /.proxy/colyseus). */
const SERVER_HOST =
  import.meta.env.VITE_SERVER_HOST || "discord-activity.up.railway.app";

/**
 * Rewrites external fetch/WebSocket/img/iframe requests to Discord proxy paths.
 * Must run before any network activity when embedded in Discord.
 */
export function setupDiscordNetworking(): void {
  if (!isEmbedded) return;

  patchUrlMappings(
    [
      { prefix: "/.proxy/colyseus", target: SERVER_HOST },
      { prefix: "/.proxy/youtube-nocookie", target: "www.youtube-nocookie.com" },
      { prefix: "/.proxy/ytimg", target: "i.ytimg.com" },
    ],
    { patchSrcAttributes: true }
  );
}
