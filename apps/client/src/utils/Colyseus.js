import { Client } from "@colyseus/sdk";
function resolveColyseusUrl() {
    if (typeof window !== "undefined" && window.location.hostname.includes("discordsays.com")) {
        return "/.proxy/colyseus";
    }
    return import.meta.env.VITE_COLYSEUS_URL || "/colyseus";
}
export const colyseusSDK = new Client(resolveColyseusUrl());
