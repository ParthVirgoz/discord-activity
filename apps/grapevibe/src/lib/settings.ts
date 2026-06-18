"use client";

const VOLUME_KEY = "synctube:volume";
const MUTED_KEY = "synctube:muted";

/** Native player volume only (0–100). YouTube iframe cannot exceed 100%. */
export const MAX_VOLUME = 100;

export function getStoredVolume(): number {
  if (typeof window === "undefined") return 80;
  const v = localStorage.getItem(VOLUME_KEY);
  const n = v ? parseInt(v, 10) : 80;
  return Number.isNaN(n) ? 80 : Math.max(0, Math.min(MAX_VOLUME, n));
}

export function saveVolume(volume: number): void {
  localStorage.setItem(VOLUME_KEY, String(Math.max(0, Math.min(MAX_VOLUME, volume))));
}

export function getStoredMuted(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(MUTED_KEY) === "1";
}

export function saveMuted(muted: boolean): void {
  localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
}
