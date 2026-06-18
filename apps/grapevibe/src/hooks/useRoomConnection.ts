"use client";

import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  HostChangedPayload,
  MembersUpdatedPayload,
  PlaybackSnapshot,
  RoomJoinedPayload,
  RoomSettings,
  VideoChangedPayload,
  VideoItem,
} from "@/lib/types";
import { getSocketServerUrl } from "@/lib/server-url";
import { useRoomStore } from "@/stores/roomStore";

export function useRoomConnection(roomId: string, userId: string, authToken: string) {
  const socketRef = useRef<Socket | null>(null);
  const store = useRoomStore;
  const wasConnectedRef = useRef(false);

  const disconnectFromRoom = useCallback(() => {
    socketRef.current?.disconnect();
  }, []);

  useEffect(() => {
    if (!roomId || !authToken) return;

    wasConnectedRef.current = false;
    store.getState().setConnectionStatus("connecting");

    const joinRoom = (socket: Socket) => {
      socket.emit("room_join", { roomId: roomId.trim() });
    };

    const socket = io(getSocketServerUrl(), {
      path: "/socket.io",
      auth: { token: authToken },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      const rejoining = wasConnectedRef.current;
      wasConnectedRef.current = true;
      store.getState().setConnectionStatus("connected");
      joinRoom(socket);
      if (rejoining) store.getState().setToast("Reconnected — back in sync");
    });

    socket.on("disconnect", () => {
      store.getState().setConnectionStatus(wasConnectedRef.current ? "reconnecting" : "connecting");
    });

    socket.io.on("reconnect_attempt", () => {
      store.getState().setConnectionStatus("reconnecting");
    });

    socket.io.on("reconnect_failed", () => {
      store.getState().setConnectionStatus("offline");
      store.getState().setToast("Could not reconnect. Try again or reload the page.");
    });

    socket.on("connect_error", () => {
      if (!wasConnectedRef.current) store.getState().setConnectionStatus("connecting");
      else store.getState().setConnectionStatus("reconnecting");
    });

    socket.on("error", (d: { message?: string }) =>
      store.getState().setToast(d.message || "Error")
    );

    socket.on("room_joined", (data: RoomJoinedPayload) => {
      store.getState().applyJoined(data);
      if (store.getState().connectionStatus === "connected") {
        store.getState().setToast(null);
      }
    });

    socket.on("member_joined", (d: { members: RoomJoinedPayload["members"] }) => {
      store.getState().setMembers(d.members);
    });
    socket.on("member_left", (d: { members: RoomJoinedPayload["members"] }) => {
      store.getState().setMembers(d.members);
    });
    socket.on("members_updated", (d: MembersUpdatedPayload) =>
      store.getState().setMembers(d.members)
    );

    socket.on("host_changed", (d: HostChangedPayload) => {
      const isHostNow = d.hostId === userId;
      store.getState().setHost(d.hostId, isHostNow);
      store.getState().setMembers(d.members);
      store.getState().setToast(`${d.hostUsername} is now the host`);
    });

    socket.on("settings_changed", (d: { settings: RoomSettings }) => {
      store.getState().setSettings(d.settings);
    });

    socket.on("permissions_updated", (d: {
      isHost: boolean;
      canAddToPlaylist: boolean;
      canReorderPlaylist: boolean;
      canPlayFromQueue: boolean;
      canControlPlayback: boolean;
    }) => store.getState().applyPermissions(d));

    socket.on("permissions_changed", (d: { settings: RoomSettings }) => {
      store.getState().setSettings(d.settings);
    });

    socket.on("queue_updated", (d: { queue: VideoItem[] }) => store.getState().setQueue(d.queue));

    socket.on("video_changed", (d: VideoChangedPayload) => {
      store.getState().setQueue(d.queue);
      store.getState().setPlayback({
        currentVideo: d.video,
        currentTime: 0,
        playing: d.autoplay !== false,
        speed: 1,
      });
    });

    socket.on("queue_empty", () =>
      store.getState().setPlayback({ currentVideo: null, currentTime: 0, playing: false, speed: 1 })
    );

    socket.on("play", (d: { currentTime: number }) =>
      store.getState().patchPlayback({ currentTime: d.currentTime, playing: true })
    );
    socket.on("pause", (d: { currentTime: number }) =>
      store.getState().patchPlayback({ currentTime: d.currentTime, playing: false })
    );
    socket.on("seek", (d: { currentTime: number }) =>
      store.getState().patchPlayback({ currentTime: d.currentTime })
    );
    socket.on("speed_change", (d: { speed: number }) =>
      store.getState().patchPlayback({ speed: d.speed })
    );
    socket.on("sync", (d: PlaybackSnapshot) => store.getState().setPlayback(d));

    return () => {
      socket.disconnect();
      socketRef.current = null;
      wasConnectedRef.current = false;
      store.getState().reset();
    };
  }, [roomId, userId, authToken, store]);

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  const reconnect = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    store.getState().setConnectionStatus("reconnecting");
    if (socket.connected) {
      socket.emit("room_join", { roomId: roomId.trim() });
      return;
    }
    socket.connect();
  }, [roomId, store]);

  return { emit, reconnect, disconnectFromRoom };
}
