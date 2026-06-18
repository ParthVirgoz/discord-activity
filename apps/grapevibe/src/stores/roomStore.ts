"use client";

import { create } from "zustand";
import { computeRoomPermissions } from "@/lib/permissions";
import type { PlaybackSnapshot, RoomMember, RoomMeta, RoomSettings, VideoItem } from "@/lib/types";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/types";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

interface RoomState {
  connected: boolean;
  connectionStatus: ConnectionStatus;
  joined: boolean;
  room: RoomMeta | null;
  isHost: boolean;
  settings: RoomSettings;
  canAddToPlaylist: boolean;
  canReorderPlaylist: boolean;
  canPlayFromQueue: boolean;
  canControlPlayback: boolean;
  members: RoomMember[];
  queue: VideoItem[];
  playback: PlaybackSnapshot | null;
  toast: string | null;
  syncing: boolean;

  setConnected: (v: boolean) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  applyJoined: (payload: {
    room: RoomMeta;
    members: RoomMember[];
    queue: VideoItem[];
    playback: PlaybackSnapshot;
    isHost: boolean;
    settings: RoomSettings;
    canAddToPlaylist: boolean;
    canReorderPlaylist: boolean;
    canPlayFromQueue: boolean;
    canControlPlayback: boolean;
  }) => void;
  setMembers: (members: RoomMember[]) => void;
  setHost: (hostId: string, isHost: boolean) => void;
  setSettings: (settings: RoomSettings) => void;
  applyPermissions: (payload: {
    isHost: boolean;
    canAddToPlaylist: boolean;
    canReorderPlaylist: boolean;
    canPlayFromQueue: boolean;
    canControlPlayback: boolean;
  }) => void;
  setQueue: (queue: VideoItem[]) => void;
  setPlayback: (playback: PlaybackSnapshot | null) => void;
  patchPlayback: (patch: Partial<PlaybackSnapshot>) => void;
  setToast: (msg: string | null) => void;
  setSyncing: (v: boolean) => void;
  reset: () => void;
}

const initialPlayback: PlaybackSnapshot = {
  currentVideo: null,
  currentTime: 0,
  playing: false,
  speed: 1,
};

const initialPerms = {
  canAddToPlaylist: false,
  canReorderPlaylist: false,
  canPlayFromQueue: false,
  canControlPlayback: false,
};

export const useRoomStore = create<RoomState>((set) => ({
  connected: false,
  connectionStatus: "connecting",
  joined: false,
  room: null,
  isHost: false,
  settings: DEFAULT_ROOM_SETTINGS,
  ...initialPerms,
  members: [],
  queue: [],
  playback: null,
  toast: null,
  syncing: false,

  setConnected: (v) =>
    set((s) => ({
      connected: v,
      connectionStatus: v ? "connected" : s.connectionStatus === "connected" ? "offline" : s.connectionStatus,
    })),
  setConnectionStatus: (connectionStatus) =>
    set({ connectionStatus, connected: connectionStatus === "connected" }),
  applyJoined: (p) => {
    const perms = computeRoomPermissions(p.isHost, p.settings);
    set({
      joined: true,
      room: p.room,
      members: p.members,
      queue: p.queue,
      playback: p.playback,
      isHost: p.isHost,
      settings: p.settings,
      ...perms,
    });
  },
  setMembers: (members) => set({ members }),
  setHost: (hostId, isHost) =>
    set((s) => ({
      isHost,
      room: s.room ? { ...s.room, hostId } : null,
      ...computeRoomPermissions(isHost, s.settings),
    })),
  setSettings: (settings) =>
    set((s) => ({
      settings,
      ...computeRoomPermissions(s.isHost, settings),
    })),
  applyPermissions: (payload) =>
    set({
      isHost: payload.isHost,
      canAddToPlaylist: payload.canAddToPlaylist,
      canReorderPlaylist: payload.canReorderPlaylist,
      canPlayFromQueue: payload.canPlayFromQueue,
      canControlPlayback: payload.canControlPlayback,
    }),
  setQueue: (queue) => set({ queue }),
  setPlayback: (playback) => set({ playback }),
  patchPlayback: (patch) =>
    set((s) => ({
      playback: s.playback ? { ...s.playback, ...patch } : { ...initialPlayback, ...patch },
    })),
  setToast: (toast) => set({ toast }),
  setSyncing: (syncing) => set({ syncing }),
  reset: () =>
    set({
      connected: false,
      connectionStatus: "connecting",
      joined: false,
      room: null,
      isHost: false,
      settings: DEFAULT_ROOM_SETTINGS,
      ...initialPerms,
      members: [],
      queue: [],
      playback: null,
      toast: null,
      syncing: false,
    }),
}));
