import { Client } from "@colyseus/sdk";
import { getServerProxyPrefix } from "./discordUrls.js";
export const colyseusSDK = new Client(getServerProxyPrefix());
