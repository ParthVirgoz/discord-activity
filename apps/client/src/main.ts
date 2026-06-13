import "./style.css";
import { setupDiscordNetworking } from "./utils/setupDiscordNetworking.js";
import { discordSDK } from "./utils/DiscordSDK.js";

setupDiscordNetworking();
import { colyseusSDK } from "./utils/Colyseus.js";
import { authenticate } from "./utils/Auth.js";
import { WatchApp } from "./ui/WatchApp.js";
import { waitForWatchState, getWatchRoomErrorMessage } from "./utils/roomState.js";
import { configureRoomResilience } from "./utils/roomConnection.js";
import { joinWatchRoom } from "./utils/watchRoomJoin.js";
const appRoot = document.getElementById("app")!;

function showError(message: string) {
  appRoot.innerHTML = `<div class="error-screen"><p>${message}</p></div>`;
}

async function connectWatchRoom() {
  const channelId = discordSDK.channelId;
  if (!channelId) {
    throw new Error("Discord channelId unavailable — join a voice channel first");
  }
  return joinWatchRoom(channelId);
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

    const room = await connectWatchRoom();
    configureRoomResilience(room);
    await waitForWatchState(room);

    appRoot.innerHTML = "";
    new WatchApp(room, appRoot);

    room.onLeave((code: number) => {
      console.log("Left room:", code);
    });
  } catch (e) {
    console.error("Failed to join room", e);
    const msg = e instanceof Error ? e.message : String(e);
    const needsDeploy =
      msg.includes("watch_room") ||
      msg.includes("not defined") ||
      msg.includes("520") ||
      msg.includes("WATCH_ROOM_STATE_UNAVAILABLE") ||
      msg.includes("old game");
    showError(needsDeploy ? getWatchRoomErrorMessage() : `Failed to join watch room: ${msg}`);
  }
})();
