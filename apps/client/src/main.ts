import "./style.css";
import { setupDiscordNetworking } from "./utils/setupDiscordNetworking.js";
import { discordSDK } from "./utils/DiscordSDK.js";

setupDiscordNetworking();
import { colyseusSDK } from "./utils/Colyseus.js";
import { authenticate } from "./utils/Auth.js";
import { GameApp } from "./ui/GameApp.js";
import { waitForGameState, getGameRoomErrorMessage } from "./utils/roomState.js";
import { configureRoomResilience } from "./utils/roomConnection.js";
import { joinGameRoom } from "./utils/gameRoomJoin.js";

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
    showLoading("Joining Bluff Party…");

    const channelId = discordSDK.channelId;
    if (!channelId) {
      throw new Error("Join a Discord voice channel, then open this Activity.");
    }

    const room = await joinGameRoom(channelId);
    configureRoomResilience(room);
    await waitForGameState(room);

    appRoot.innerHTML = "";
    new GameApp(room, appRoot);
  } catch (e) {
    console.error("Failed to join game room", e);
    const msg = e instanceof Error ? e.message : String(e);
    const needsDeploy =
      msg.includes("GAME_ROOM_STATE_UNAVAILABLE") ||
      msg.includes("not defined") ||
      msg.includes("520") ||
      msg.includes("old game") ||
      msg.includes("queue");
    showError(needsDeploy ? getGameRoomErrorMessage() : `Failed to join game: ${msg}`);
  }
})();
