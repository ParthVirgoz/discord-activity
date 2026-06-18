import type { Server as HttpServer } from "http";
import type { Socket } from "socket.io";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import type { RoomSettings, VideoItem } from "@/lib/types";
import { isValidChannelId, sanitizeUsername, verifyDiscordToken } from "./discord-auth";
import {
  addMember,
  addToQueue,
  canAddToPlaylist,
  canControlPlayback,
  canPlayFromQueue,
  canReorderPlaylist,
  claimHost,
  clearQueue,
  ensureRoom,
  getHostId,
  getMemberPermissions,
  getPlaybackSnapshot,
  getQueue,
  getRoom,
  getSettings,
  isHost,
  loadNextVideo,
  moveToPlayNext,
  pause,
  play,
  playQueueItem,
  reconcileHost,
  removeFromQueue,
  removeMember,
  reorderQueue,
  seek,
  setSpeed,
  setVideoDirect,
  transferHost,
  updateMemberUsername,
  updateSettings,
} from "./room-store";

interface SocketUser {
  userId: string;
  username: string;
  avatarUrl?: string;
  roomId: string | null;
}

function discordAvatarUrl(userId: string, avatar: string) {
  if (avatar) return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=64`;
  const index = Number(BigInt(userId) % BigInt(6));
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function normalizeRoomId(roomId: string): string {
  return roomId.trim();
}

const sockets = new Map<string, SocketUser>();
let io: Server | null = null;

function buildVideoItem(
  data: {
    source?: string;
    url?: string;
    videoId?: string;
    title?: string;
    mimeType?: string;
    thumbnail?: string;
    channel?: string;
  },
  addedBy: string
): VideoItem | null {
  const title = (data.title || "Video").slice(0, 120);
  if (data.source === "youtube" || data.videoId) {
    const videoId = data.videoId?.trim();
    if (!videoId || videoId.length !== 11) return null;
    const item: VideoItem = {
      id: nanoid(10),
      source: "youtube",
      videoId,
      title,
      thumbnail: data.thumbnail || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      addedBy,
    };
    if (data.channel?.trim()) item.channel = data.channel.trim().slice(0, 80);
    return item;
  }
  if (!data.url?.startsWith("http")) return null;
  return {
    id: nanoid(10),
    source: "direct",
    url: data.url.trim(),
    title,
    mimeType: data.mimeType || "video/mp4",
    addedBy,
  };
}

function hostUsername(roomId: string): string {
  const hostId = getHostId(roomId);
  const room = getRoom(roomId);
  if (!room || !hostId) return "Host";
  return [...room.members.values()].find((m) => m.userId === hostId)?.username ?? "Host";
}

function broadcastHostChanged(roomId: string) {
  const hostId = getHostId(roomId);
  const room = getRoom(roomId);
  io?.to(roomId).emit("host_changed", {
    hostId,
    hostUsername: hostUsername(roomId),
    members: room ? [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt) : [],
  });
}

function joinedPayload(roomId: string, userId: string) {
  const settings = getSettings(roomId);
  const permissions = getMemberPermissions(roomId, userId);
  return {
    room: getRoom(roomId)!.meta,
    members: [...getRoom(roomId)!.members.values()].sort((a, b) => a.joinedAt - b.joinedAt),
    queue: getQueue(roomId),
    playback: getPlaybackSnapshot(roomId)!,
    settings,
    ...permissions,
  };
}

function emitPermissionsForRoom(roomId: string) {
  const room = getRoom(roomId);
  if (!room || !io) return;
  for (const member of room.members.values()) {
    io.to(member.socketId).emit("permissions_updated", getMemberPermissions(roomId, member.userId));
  }
}

export function initSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, { path: "/socket.io", cors: { origin: "*" } });

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth.token as string | undefined) ||
        (socket.handshake.auth.accessToken as string | undefined);
      if (!token) {
        next(new Error("Unauthorized"));
        return;
      }
      const user = await verifyDiscordToken(token);
      socket.data.discordUser = user;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const discordUser = socket.data.discordUser as {
      id: string;
      username: string;
      avatar: string;
    };
    const userId = discordUser.id;
    const username = sanitizeUsername(discordUser.username);
    const avatarUrl = discordAvatarUrl(userId, discordUser.avatar);

    sockets.set(socket.id, { userId, username, avatarUrl, roomId: null });

    socket.on("room_join", (data: { roomId?: string }) => {
      const conn = sockets.get(socket.id);
      if (!conn || !data.roomId) return;

      const roomId = normalizeRoomId(data.roomId);
      if (!isValidChannelId(roomId)) {
        socket.emit("error", { message: "Invalid voice channel." });
        return;
      }

      let room = getRoom(roomId);
      if (!room) {
        ensureRoom(roomId, conn.userId);
        room = getRoom(roomId);
      }
      if (!room) {
        socket.emit("error", { message: "Could not create room." });
        return;
      }

      if (conn.roomId && conn.roomId !== roomId) socket.leave(conn.roomId);
      socket.join(roomId);
      conn.roomId = roomId;

      const members = addMember(roomId, {
        userId: conn.userId,
        username: conn.username,
        avatarUrl: conn.avatarUrl,
        socketId: socket.id,
        joinedAt: Date.now(),
      });

      const hostReconciled = reconcileHost(roomId);
      if (hostReconciled) broadcastHostChanged(roomId);

      socket.emit("room_joined", {
        ...joinedPayload(roomId, conn.userId),
        members,
      });

      socket.to(roomId).emit("member_joined", {
        user: { userId: conn.userId, username: conn.username, avatarUrl: conn.avatarUrl },
        members,
      });
    });

    socket.on("update_username", (data: { username?: string }) => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || typeof data.username !== "string") return;
      const name = data.username.trim().slice(0, 32);
      if (!name) return;
      conn.username = name;
      const members = updateMemberUsername(conn.roomId, socket.id, name);
      if (members) io!.to(conn.roomId).emit("members_updated", { members });
    });

    socket.on("settings_update", (data: Partial<RoomSettings>) => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !isHost(conn.roomId, conn.userId)) return;
      const settings = updateSettings(conn.roomId, conn.userId, data);
      if (!settings) return;
      io!.to(conn.roomId).emit("settings_changed", { settings });
      emitPermissionsForRoom(conn.roomId);
    });

    socket.on("claim_host", () => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId) return;
      if (!claimHost(conn.roomId, conn.userId)) {
        socket.emit("error", { message: "Cannot become host." });
        return;
      }
      broadcastHostChanged(conn.roomId);
      emitPermissionsForRoom(conn.roomId);
    });

    socket.on("transfer_host", (data: { targetUserId?: string }) => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !isHost(conn.roomId, conn.userId)) return;
      if (typeof data.targetUserId !== "string" || data.targetUserId === conn.userId) return;
      if (!transferHost(conn.roomId, conn.userId, data.targetUserId)) return;
      broadcastHostChanged(conn.roomId);
      emitPermissionsForRoom(conn.roomId);
    });

    socket.on(
      "video_added",
      (data: {
        source?: string;
        url?: string;
        videoId?: string;
        title?: string;
        mimeType?: string;
        thumbnail?: string;
      }) => {
        const conn = sockets.get(socket.id);
        if (!conn?.roomId || !canAddToPlaylist(conn.roomId, conn.userId)) return;

        const item = buildVideoItem(data, conn.userId);
        if (!item) {
          socket.emit("error", { message: "Invalid video." });
          return;
        }

        const queue = addToQueue(conn.roomId, item);
        if (!queue) {
          socket.emit("error", { message: "Queue is full." });
          return;
        }

        if (!getPlaybackSnapshot(conn.roomId)?.currentVideo) {
          const result = loadNextVideo(conn.roomId);
          if (!result) return;
          if (result === "empty") {
            io!.to(conn.roomId).emit("queue_updated", { queue: getQueue(conn.roomId) });
          } else {
            io!.to(conn.roomId).emit("video_changed", result);
          }
        } else {
          io!.to(conn.roomId).emit("queue_updated", { queue });
        }
      }
    );

    socket.on(
      "video_load",
      (data: {
        source?: string;
        url?: string;
        videoId?: string;
        title?: string;
        mimeType?: string;
        thumbnail?: string;
      }) => {
        const conn = sockets.get(socket.id);
        if (!conn?.roomId || !canControlPlayback(conn.roomId, conn.userId)) return;
        const video = buildVideoItem(data, conn.userId);
        if (!video) {
          socket.emit("error", { message: "Invalid video." });
          return;
        }
        const result = setVideoDirect(conn.roomId, video);
        io!.to(conn.roomId).emit("video_changed", result);
      }
    );

    socket.on("video_removed", (data: { itemId?: string }) => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !canReorderPlaylist(conn.roomId, conn.userId) || !data.itemId) return;
      const queue = removeFromQueue(conn.roomId, data.itemId);
      if (queue) io!.to(conn.roomId).emit("queue_updated", { queue });
    });

    socket.on("queue_clear", () => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !canReorderPlaylist(conn.roomId, conn.userId)) return;
      const queue = clearQueue(conn.roomId);
      if (queue) io!.to(conn.roomId).emit("queue_updated", { queue });
    });

    socket.on("queue_reorder", (data: { itemId?: string; direction?: "up" | "down" }) => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !canReorderPlaylist(conn.roomId, conn.userId) || !data.itemId) return;
      if (data.direction !== "up" && data.direction !== "down") return;
      const queue = reorderQueue(conn.roomId, data.itemId, data.direction);
      if (queue) io!.to(conn.roomId).emit("queue_updated", { queue });
    });

    socket.on("queue_play_next", (data: { itemId?: string }) => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !canReorderPlaylist(conn.roomId, conn.userId) || !data.itemId) return;
      const queue = moveToPlayNext(conn.roomId, data.itemId);
      if (queue) io!.to(conn.roomId).emit("queue_updated", { queue });
    });

    socket.on("video_changed", (data: { itemId?: string }) => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !canPlayFromQueue(conn.roomId, conn.userId) || !data.itemId) return;
      const result = playQueueItem(conn.roomId, data.itemId);
      if (result) io!.to(conn.roomId).emit("video_changed", result);
    });

    socket.on("play", (data: { currentTime?: number }) => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !canControlPlayback(conn.roomId, conn.userId)) return;
      const snapshot = play(conn.roomId, Number(data.currentTime) || 0);
      io!.to(conn.roomId).emit("play", { currentTime: snapshot?.currentTime ?? 0 });
    });

    socket.on("pause", (data: { currentTime?: number }) => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !canControlPlayback(conn.roomId, conn.userId)) return;
      const snapshot = pause(conn.roomId, Number(data.currentTime) || 0);
      io!.to(conn.roomId).emit("pause", { currentTime: snapshot?.currentTime ?? 0 });
    });

    socket.on("seek", (data: { currentTime?: number }) => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !canControlPlayback(conn.roomId, conn.userId)) return;
      const snapshot = seek(conn.roomId, Number(data.currentTime) || 0);
      io!.to(conn.roomId).emit("seek", { currentTime: snapshot?.currentTime ?? 0 });
    });

    socket.on("speed_change", (data: { speed?: number }) => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !canControlPlayback(conn.roomId, conn.userId)) return;
      const snapshot = setSpeed(conn.roomId, Number(data.speed) || 1);
      io!.to(conn.roomId).emit("speed_change", { speed: snapshot?.speed ?? 1 });
    });

    socket.on("sync", () => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId) return;
      const snapshot = getPlaybackSnapshot(conn.roomId);
      if (snapshot) socket.emit("sync", snapshot);
    });

    socket.on("skip", () => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !canControlPlayback(conn.roomId, conn.userId)) return;
      const result = loadNextVideo(conn.roomId);
      if (!result) return;
      if (result === "empty") io!.to(conn.roomId).emit("queue_empty", {});
      else io!.to(conn.roomId).emit("video_changed", result);
    });

    socket.on("video_ended", () => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId || !canControlPlayback(conn.roomId, conn.userId)) return;
      const result = loadNextVideo(conn.roomId);
      if (!result) return;
      if (result === "empty") io!.to(conn.roomId).emit("queue_empty", {});
      else io!.to(conn.roomId).emit("video_changed", result);
    });

    socket.on("disconnect", () => {
      const conn = sockets.get(socket.id);
      if (!conn?.roomId) {
        sockets.delete(socket.id);
        return;
      }
      const roomId = conn.roomId;
      const { members, hostChanged } = removeMember(roomId, socket.id);
      if (members.length > 0) {
        socket.to(roomId).emit("member_left", {
          userId: conn.userId,
          username: conn.username,
          members,
        });
        if (hostChanged) broadcastHostChanged(roomId);
      }
      sockets.delete(socket.id);
    });
  });

  return io;
}
