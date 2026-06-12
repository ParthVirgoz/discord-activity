import { JWT } from "@colyseus/auth";
import { Room, Client } from "colyseus";
import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import {
  isValidChannelId,
  isValidVideoId,
  sanitizeTitle,
  sanitizeUsername,
  clampTime,
  clampPlaybackRate,
  clampQueueIndex,
  MAX_QUEUE_SIZE,
} from "../utils/validation";

const DRIFT_THRESHOLD_SEC = 2;
const MESSAGE_COOLDOWN_MS = 100;

export class QueueItem extends Schema {
  @type("string") videoId = "";
  @type("string") title = "";
  @type("string") addedBy = "";
}

export class Member extends Schema {
  @type("string") username = "";
  @type("string") avatarUrl = "";
  @type("string") discordId = "";
}

export class WatchRoomState extends Schema {
  @type("string") hostSessionId = "";
  @type("string") videoId = "";
  @type("string") videoTitle = "";
  @type("number") currentTime = 0;
  @type("boolean") isPlaying = false;
  @type("number") playbackRate = 1;
  @type("number") lastUpdatedAt = 0;
  @type({ array: QueueItem }) queue = new ArraySchema<QueueItem>();
  @type({ map: Member }) members = new MapSchema<Member>();
}

export interface SyncPayload {
  videoId: string;
  videoTitle: string;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  hostSessionId: string;
}

export class WatchRoom extends Room {
  state = new WatchRoomState();
  maxClients = 25;

  private channelId = "";
  private lastMessageAt = new Map<string, number>();

  static onAuth(token: string) {
    return JWT.verify(token);
  }

  private isHost(client: Client): boolean {
    return this.state.hostSessionId === client.sessionId;
  }

  private effectiveTime(): number {
    if (!this.state.isPlaying) {
      return this.state.currentTime;
    }
    const elapsedSec = (Date.now() - this.state.lastUpdatedAt) / 1000;
    return this.state.currentTime + elapsedSec * this.state.playbackRate;
  }

  private buildSyncPayload(forceTime?: number): SyncPayload {
    return {
      videoId: this.state.videoId,
      videoTitle: this.state.videoTitle,
      currentTime: forceTime ?? this.effectiveTime(),
      isPlaying: this.state.isPlaying,
      playbackRate: this.state.playbackRate,
      hostSessionId: this.state.hostSessionId,
    };
  }

  private rateLimit(client: Client): boolean {
    const now = Date.now();
    const last = this.lastMessageAt.get(client.sessionId) ?? 0;
    if (now - last < MESSAGE_COOLDOWN_MS) return false;
    this.lastMessageAt.set(client.sessionId, now);
    return true;
  }

  private requireHost(client: Client): boolean {
    return this.isHost(client);
  }

  private applyPlay(currentTime: number, playbackRate?: number) {
    this.state.isPlaying = true;
    this.state.currentTime = clampTime(currentTime);
    if (playbackRate !== undefined) {
      this.state.playbackRate = clampPlaybackRate(playbackRate);
    }
    this.state.lastUpdatedAt = Date.now();
  }

  private applyPause(currentTime: number) {
    this.state.isPlaying = false;
    this.state.currentTime = clampTime(currentTime);
    this.state.lastUpdatedAt = Date.now();
  }

  private applySeek(currentTime: number) {
    this.state.currentTime = clampTime(currentTime);
    this.state.lastUpdatedAt = Date.now();
  }

  private loadVideo(videoId: string, title: string) {
    this.state.videoId = videoId;
    this.state.videoTitle = title;
    this.state.currentTime = 0;
    this.state.isPlaying = false;
    this.state.playbackRate = 1;
    this.state.lastUpdatedAt = Date.now();
  }

  private promoteNextHost(): void {
    const members = [...this.state.members.keys()];
    const nextHost = members.find((sid) => sid !== this.state.hostSessionId);
    this.state.hostSessionId = nextHost ?? "";
  }

  private advanceQueue(): boolean {
    if (this.state.queue.length === 0) return false;
    const next = this.state.queue.shift()!;
    this.loadVideo(next.videoId, next.title);
    this.broadcast("videoChanged", this.buildSyncPayload(0));
    return true;
  }

  onCreate(options: { channelId?: string }) {
    if (!isValidChannelId(options?.channelId)) {
      throw new Error("Invalid channelId");
    }
    this.channelId = options.channelId;

    this.onMessage("play", (client, msg: { currentTime?: number }) => {
      if (!this.rateLimit(client) || !this.requireHost(client)) return;
      this.applyPlay(clampTime(msg?.currentTime));
      this.broadcast("play", { currentTime: this.state.currentTime });
    });

    this.onMessage("pause", (client, msg: { currentTime?: number }) => {
      if (!this.rateLimit(client) || !this.requireHost(client)) return;
      this.applyPause(clampTime(msg?.currentTime));
      this.broadcast("pause", { currentTime: this.state.currentTime });
    });

    this.onMessage("seek", (client, msg: { currentTime?: number }) => {
      if (!this.rateLimit(client) || !this.requireHost(client)) return;
      this.applySeek(clampTime(msg?.currentTime));
      this.broadcast("seek", { currentTime: this.state.currentTime });
    });

    this.onMessage("setRate", (client, msg: { rate?: number; currentTime?: number }) => {
      if (!this.rateLimit(client) || !this.requireHost(client)) return;
      this.state.playbackRate = clampPlaybackRate(msg?.rate);
      this.applySeek(clampTime(msg?.currentTime));
      this.broadcast("setRate", {
        rate: this.state.playbackRate,
        currentTime: this.state.currentTime,
      });
    });

    this.onMessage("loadVideo", (client, msg: { videoId?: string; title?: string }) => {
      if (!this.rateLimit(client) || !this.requireHost(client)) return;
      if (!isValidVideoId(msg?.videoId)) return;
      this.loadVideo(msg.videoId, sanitizeTitle(msg?.title));
      this.broadcast("videoChanged", this.buildSyncPayload(0));
    });

    this.onMessage("addToQueue", (client, msg: { videoId?: string; title?: string }) => {
      if (!this.rateLimit(client) || !this.requireHost(client)) return;
      if (!isValidVideoId(msg?.videoId)) return;
      if (this.state.queue.length >= MAX_QUEUE_SIZE) return;

      const item = new QueueItem();
      item.videoId = msg.videoId!;
      item.title = sanitizeTitle(msg?.title);
      item.addedBy = sanitizeUsername(client.auth?.username);
      this.state.queue.push(item);
    });

    this.onMessage(
      "addBatchToQueue",
      (client, msg: { items?: { videoId?: string; title?: string }[] }) => {
        if (!this.rateLimit(client) || !this.requireHost(client)) return;
        if (!Array.isArray(msg?.items)) return;

        const addedBy = sanitizeUsername(client.auth?.username);
        let added = 0;
        for (const entry of msg.items) {
          if (this.state.queue.length >= MAX_QUEUE_SIZE) break;
          if (!isValidVideoId(entry?.videoId)) continue;
          const item = new QueueItem();
          item.videoId = entry.videoId!;
          item.title = sanitizeTitle(entry?.title);
          item.addedBy = addedBy;
          this.state.queue.push(item);
          added += 1;
        }
        if (added > 0) {
          client.send("batchQueued", { count: added });
        }
      }
    );

    this.onMessage("removeFromQueue", (client, msg: { index?: number }) => {
      if (!this.rateLimit(client) || !this.requireHost(client)) return;
      const index = clampQueueIndex(msg?.index, this.state.queue.length);
      if (index === null) return;
      this.state.queue.splice(index, 1);
    });

    this.onMessage("clearQueue", (client) => {
      if (!this.rateLimit(client) || !this.requireHost(client)) return;
      this.state.queue.clear();
    });

    this.onMessage("skipVideo", (client) => {
      if (!this.rateLimit(client) || !this.requireHost(client)) return;
      if (!this.advanceQueue()) {
        this.loadVideo("", "");
        this.broadcast("queueEmpty", {});
      }
    });

    this.onMessage("videoEnded", (client) => {
      if (!this.rateLimit(client) || !this.requireHost(client)) return;
      if (!this.advanceQueue()) {
        this.applyPause(this.effectiveTime());
        this.broadcast("pause", { currentTime: this.state.currentTime });
      }
    });

    this.onMessage("syncReport", (client, msg: { currentTime?: number }) => {
      if (!this.rateLimit(client) || this.isHost(client)) return;
      const clientTime = clampTime(msg?.currentTime);
      const serverTime = this.effectiveTime();
      if (Math.abs(serverTime - clientTime) > DRIFT_THRESHOLD_SEC) {
        client.send("forceSync", this.buildSyncPayload(serverTime));
      }
    });

    this.onMessage("syncRequest", (client) => {
      if (!this.rateLimit(client)) return;
      client.send("sync", this.buildSyncPayload());
    });
  }

  onJoin(client: Client, options: { channelId?: string }) {
    if (!isValidChannelId(options?.channelId) || options.channelId !== this.channelId) {
      throw new Error("Invalid channelId");
    }

    const auth = client.auth as { id?: string; username?: string; avatar?: string } | undefined;
    const discordId = typeof auth?.id === "string" ? auth.id : client.sessionId;
    const username = sanitizeUsername(auth?.username);
    const avatarHash = typeof auth?.avatar === "string" ? auth.avatar : "";

    const member = new Member();
    member.username = username;
    member.discordId = discordId;
    member.avatarUrl = avatarHash
      ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`
      : "";
    this.state.members.set(client.sessionId, member);

    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }

    client.send("roomJoined", {
      sessionId: client.sessionId,
      isHost: this.isHost(client),
      sync: this.buildSyncPayload(),
    });
  }

  onLeave(client: Client) {
    this.state.members.delete(client.sessionId);
    this.lastMessageAt.delete(client.sessionId);

    if (this.isHost(client)) {
      this.promoteNextHost();
      this.broadcast("hostChanged", { hostSessionId: this.state.hostSessionId });
    }

    if (this.state.members.size === 0) {
      this.disconnect();
    }
  }

  onDispose() {
    console.log("watch_room disposed for channel", this.channelId);
  }
}
