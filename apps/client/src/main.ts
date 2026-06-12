import "./style.css";
import { discordSDK } from "./utils/DiscordSDK.js";
import { colyseusSDK } from "./utils/Colyseus.js";
import type { WatchRoomState } from "./schema.js";
import { authenticate } from "./utils/Auth.js";
import { WatchApp } from "./ui/WatchApp.js";

const appRoot = document.getElementById("app")!;

function showError(message: string) {
  appRoot.innerHTML = `<div class="error-screen"><p>${message}</p></div>`;
}

function showLoading(message: string) {
  appRoot.innerHTML = `
    <div class="loading-screen">
      <div class="loading-spinner"></div>
      <p>${message}</p>
    </div>
  `;
}

(async () => {
  showLoading("Signing in with Discord…");

  try {
    const authData = await authenticate();
    colyseusSDK.auth.token = authData.token;
  } catch (e) {
    console.error("Failed to authenticate", e);
    showError("Failed to authenticate. Check Discord client ID and server secret.");
    return;
  }

  try {
    showLoading("Joining your voice channel room…");

    const room = await colyseusSDK.joinOrCreate<WatchRoomState>("watch_room", {
      channelId: discordSDK.channelId,
    });

    appRoot.innerHTML = "";
    new WatchApp(room, appRoot);

    room.onLeave((code) => {
      console.log("Left room:", code);
    });
  } catch (e) {
    console.error("Failed to join room", e);
    showError("Failed to join watch room. Is the server running?");
  }
})();
