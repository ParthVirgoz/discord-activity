"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { getStoredMuted, getStoredVolume, MAX_VOLUME, saveMuted, saveVolume } from "@/lib/settings";

interface UserState {
  userId: string;
  username: string;
  hasSetDisplayName: boolean;
  volume: number;
  muted: boolean;
  ensureUserId: () => string;
  setUsername: (name: string) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      userId: "",
      username: "Guest",
      hasSetDisplayName: false,
      volume: 80,
      muted: false,
      ensureUserId: () => {
        let id = get().userId;
        if (!id) {
          id = nanoid(12);
          set({ userId: id });
        }
        return id;
      },
      setUsername: (name) => {
        const trimmed = name.trim().slice(0, 32) || "Guest";
        set({
          username: trimmed,
          hasSetDisplayName: trimmed !== "Guest",
        });
      },
      setVolume: (v) => {
        const vol = Math.max(0, Math.min(MAX_VOLUME, v));
        saveVolume(vol);
        set({ volume: vol });
      },
      setMuted: (m) => {
        saveMuted(m);
        set({ muted: m });
      },
    }),
    {
      name: "synctube-user",
      partialize: (s) => ({
        userId: s.userId,
        username: s.username,
        hasSetDisplayName: s.hasSetDisplayName,
        volume: s.volume,
        muted: s.muted,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.volume = getStoredVolume();
          state.muted = getStoredMuted();
          if (state.username && state.username !== "Guest") {
            state.hasSetDisplayName = true;
          }
        }
      },
    }
  )
);
