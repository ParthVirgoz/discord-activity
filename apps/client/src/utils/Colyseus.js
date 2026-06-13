import { Client } from "@colyseus/sdk";

function resolveColyseusUrl() {
  const configured = import.meta.env.VITE_COLYSEUS_URL;
  if (typeof configured === "string" && configured.length > 0) {
    return configured.replace(/\/$/, "");
  }
  return "/colyseus";
}

export const colyseusSDK = new Client(resolveColyseusUrl());
