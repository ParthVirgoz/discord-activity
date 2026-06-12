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

async function joinWatchRoom() {
  const roomNames = ["my_room", "watch_room"];
  let lastError: unknown;
  for (const roomName of roomNames) {
    try {
      return await colyseusSDK.joinOrCreate<WatchRoomState>(roomName, {
        channelId: discordSDK.channelId,
      });
    } catch (e) {
      lastError = e;
      console.warn(`joinOrCreate(${roomName}) failed:`, e);
    }
  }
  throw lastError;
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

    const room = await joinWatchRoom();

    appRoot.innerHTML = "";
    new WatchApp(room, appRoot);

    room.onLeave((code) => {
      console.log("Left room:", code);
    });
  } catch (e) {
    console.error("Failed to join room", e);
    const msg = e instanceof Error ? e.message : String(e);
    const needsDeploy =
      msg.includes("watch_room") ||
      msg.includes("not defined") ||
      msg.includes("520");
    showError(
      needsDeploy
        ? "Server is outdated — redeploy Railway from the latest GitHub code, then try again."
        : `Failed to join watch room: ${msg}`
    );
  }
})();
