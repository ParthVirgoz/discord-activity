import { JWT } from "@colyseus/auth";
import { Room, Client, CloseCode } from "colyseus";
import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import {
  isValidChannelId,
  isValidVideoId,
  sanitizeTitle,
  sanitizeUsername,
  clampTime,
  clampPlaybackRate,
  clampQueueIndex,
  clampDuration,
  MAX_QUEUE_SIZE,
} from "../utils/validation";

const DRIFT_THRESHOLD_SEC = 2;
const MESSAGE_COOLDOWN_MS = 100;

export type QueueItemStatus = "queued" | "playing" | "played" | "unavailable";

export class QueueItem extends Schema {
  @type("string") videoId = "";
  @type("string") title = "";
  @type("string") channelName = "";
  @type("string") addedBy = "";
  @type("string") addedBySessionId = "";
  @type("string") status: QueueItemStatus = "queued";
  @type("number") durationSec = 0;
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
  @type("number") videoDurationSec = 0;
  @type("boolean") allowEveryoneQueue = false;
  @type("boolean") allowEveryonePlayback = false;
  @type("boolean") allowOthersToHost = false;
  @type("boolean") allowReplayPlayed = true;
  @type("boolean") dimPlayedInPlaylist = false;
  /** When true, after jumping to a later song, continue from the next song in list order. */
  @type("boolean") continueFromPosition = true;
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
  videoDurationSec: number;
  allowEveryoneQueue: boolean;
  allowEveryonePlayback: boolean;
  allowOthersToHost: boolean;
  allowReplayPlayed: boolean;
  dimPlayedInPlaylist: boolean;
  continueFromPosition: boolean;
}

export interface PermissionsPayload {
  allowEveryoneQueue: boolean;
  allowEveryonePlayback: boolean;
  allowOthersToHost: boolean;
  allowReplayPlayed: boolean;
  dimPlayedInPlaylist: boolean;
  continueFromPosition: boolean;
}

export class WatchRoom extends Room {
  state = new WatchRoomState();
  maxClients = 25;

  private channelId = "";
  private lastMessageAt = new Map<string, number>();
  private lastVideoEndedAt = 0;
  private lastUnavailableVideoId = "";

  static onAuth(token: string) {
    return JWT.verify(token);
  }

  private isHost(client: Client): boolean {
    return this.state.hostSessionId === client.sessionId;
  }

  private canControlPlayback(client: Client): boolean {
    return this.isHost(client) || this.state.allowEveryonePlayback;
  }

  private canEditQueue(client: Client): boolean {
    return this.isHost(client) || this.state.allowEveryoneQueue;
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
      videoDurationSec: this.state.videoDurationSec,
      allowEveryoneQueue: this.state.allowEveryoneQueue,
      allowEveryonePlayback: this.state.allowEveryonePlayback,
      allowOthersToHost: this.state.allowOthersToHost,
      allowReplayPlayed: this.state.allowReplayPlayed,
      dimPlayedInPlaylist: this.state.dimPlayedInPlaylist,
      continueFromPosition: this.state.continueFromPosition,
    };
  }

  private buildPermissionsPayload(): PermissionsPayload {
    return {
      allowEveryoneQueue: this.state.allowEveryoneQueue,
      allowEveryonePlayback: this.state.allowEveryonePlayback,
      allowOthersToHost: this.state.allowOthersToHost,
      allowReplayPlayed: this.state.allowReplayPlayed,
      dimPlayedInPlaylist: this.state.dimPlayedInPlaylist,
      continueFromPosition: this.state.continueFromPosition,
    };
  }

  private rateLimit(client: Client): boolean {
    const now = Date.now();
    const last = this.lastMessageAt.get(client.sessionId) ?? 0;
    if (now - last < MESSAGE_COOLDOWN_MS) return false;
    this.lastMessageAt.set(client.sessionId, now);
    return true;
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

  private markPlayingAsPlayed(): void {
    for (const item of this.state.queue) {
      if (item.status === "playing") {
        item.status = "played";
      }
    }
  }

  private markPlayingAsUnavailable(): void {
    for (const item of this.state.queue) {
      if (item.status === "playing") {
        item.status = "unavailable";
      }
    }
  }

  private makeRoomInQueue(): void {
    while (this.state.queue.length >= MAX_QUEUE_SIZE) {
      const playedIdx = this.state.queue.findIndex(
        (item) => item.status === "played" || item.status === "unavailable"
      );
      if (playedIdx === -1) break;
      this.state.queue.splice(playedIdx, 1);
    }
  }

  private setNowPlaying(
    videoId: string,
    title: string,
    durationSec: number,
    addedBy: string,
    addedBySessionId: string,
    autoPlay: boolean
  ): void {
    this.markPlayingAsPlayed();

    let item = this.state.queue.find((q) => q.videoId === videoId && q.status !== "played");
    if (!item) {
      this.makeRoomInQueue();
      if (this.state.queue.length >= MAX_QUEUE_SIZE) return;

      item = new QueueItem();
      item.videoId = videoId;
      item.title = title;
      item.addedBy = addedBy;
      item.addedBySessionId = addedBySessionId;
      item.durationSec = durationSec;
      item.status = "playing";
      this.state.queue.push(item);
    } else {
      item.status = "playing";
      item.title = title || item.title;
      if (durationSec > 0) item.durationSec = durationSec;
    }

    this.state.videoId = videoId;
    this.state.videoTitle = title || item.title;
    this.state.videoDurationSec = durationSec > 0 ? durationSec : item.durationSec;
    this.state.currentTime = 0;
    this.state.playbackRate = 1;
    this.state.lastUpdatedAt = Date.now();

    if (autoPlay) {
      this.applyPlay(0);
    } else {
      this.state.isPlaying = false;
    }
  }

  private isQueueIdle(): boolean {
    return !this.state.queue.some((item) => item.status === "playing");
  }

  private tryAutostart(): void {
    if (!this.isQueueIdle()) return;
    const next = this.state.queue.find((i) => i.status === "queued");
    if (!next) return;

    next.status = "playing";
    this.state.videoId = next.videoId;
    this.state.videoTitle = next.title;
    this.state.videoDurationSec = next.durationSec;
    this.state.currentTime = 0;
    this.state.playbackRate = 1;
    this.state.lastUpdatedAt = Date.now();
    this.applyPlay(0);
    this.broadcast("videoChanged", this.buildSyncPayload(0));
    this.broadcast("play", { currentTime: 0 });
  }

  private findPlayingIndex(): number {
    return this.state.queue.findIndex((item) => item.status === "playing");
  }

  private findNextQueuedItem(afterIndex: number): QueueItem | null {
    if (this.state.continueFromPosition) {
      for (let i = afterIndex + 1; i < this.state.queue.length; i++) {
        const item = this.state.queue[i];
        if (item.status === "queued") return item;
      }
      return null;
    }
    return this.state.queue.find((item) => item.status === "queued") ?? null;
  }

  private startQueueItem(item: QueueItem, autoPlay = true): void {
    this.lastUnavailableVideoId = "";
    item.status = "playing";
    this.state.videoId = item.videoId;
    this.state.videoTitle = item.title;
    this.state.videoDurationSec = item.durationSec;
    this.state.currentTime = 0;
    this.state.playbackRate = 1;
    this.state.lastUpdatedAt = Date.now();

    if (autoPlay) {
      this.applyPlay(0);
    } else {
      this.state.isPlaying = false;
    }

    this.broadcast("videoChanged", this.buildSyncPayload(0));
    if (autoPlay) {
      this.broadcast("play", { currentTime: 0 });
    }
  }

  private clearNowPlaying(): void {
    this.state.videoId = "";
    this.state.videoTitle = "";
    this.state.videoDurationSec = 0;
    this.state.currentTime = 0;
    this.applyPause(0);
    this.broadcast("pause", { currentTime: 0 });
    this.broadcast("videoChanged", this.buildSyncPayload(0));
    this.broadcast("queueEmpty", {});
  }

  private promoteNextHost(): void {
    const members = [...this.state.members.keys()];
    const nextHost = members.find((sid) => sid !== this.state.hostSessionId);
    this.state.hostSessionId = nextHost ?? "";
  }

  private advanceQueue(autoPlay = true): boolean {
    const playingIdx = this.findPlayingIndex();
    this.markPlayingAsPlayed();

    const next = this.findNextQueuedItem(playingIdx);
    if (!next) return false;

    this.startQueueItem(next, autoPlay);
    return true;
  }

  private handleVideoComplete(): void {
    if (!this.state.videoId) return;

    const now = Date.now();
    if (now - this.lastVideoEndedAt < 2500) return;
    this.lastVideoEndedAt = now;

    if (!this.advanceQueue(true)) {
      this.applyPause(this.effectiveTime());
      this.broadcast("pause", { currentTime: this.state.currentTime });
      this.broadcast("queueEmpty", {});
    }
  }

  private handleVideoUnavailable(): void {
    if (!this.state.videoId) return;

    const playingIdx = this.findPlayingIndex();
    if (playingIdx === -1) return;

    const playing = this.state.queue[playingIdx];
    if (playing.videoId !== this.state.videoId) return;
    if (this.lastUnavailableVideoId === this.state.videoId) return;
    this.lastUnavailableVideoId = this.state.videoId;

    this.markPlayingAsUnavailable();

    const next = this.findNextQueuedItem(playingIdx);
    if (!next) {
      this.clearNowPlaying();
      return;
    }

    this.startQueueItem(next, true);
  }

  private maybeAdvanceAtEnd(): void {
    if (!this.state.videoId || !this.state.isPlaying) return;
    if (this.state.videoDurationSec <= 0) return;
    if (this.effectiveTime() < this.state.videoDurationSec - 1) return;
    this.handleVideoComplete();
  }

  private playQueueItemAt(index: number, autoPlay = true): void {
    const item = this.state.queue[index];
    if (!item || item.status === "unavailable") return;

    this.markPlayingAsPlayed();
    this.lastUnavailableVideoId = "";
    item.status = "playing";
    this.state.videoId = item.videoId;
    this.state.videoTitle = item.title;
    this.state.videoDurationSec = item.durationSec;
    this.state.currentTime = 0;
    this.state.playbackRate = 1;
    this.state.lastUpdatedAt = Date.now();

    if (autoPlay) {
      this.applyPlay(0);
    } else {
      this.state.isPlaying = false;
    }

    this.broadcast("videoChanged", this.buildSyncPayload(0));
    if (autoPlay) {
      this.broadcast("play", { currentTime: 0 });
    }
  }

  onCreate(options: { channelId?: string }) {
    if (!isValidChannelId(options?.channelId)) {
      throw new Error("Invalid channelId");
    }
    this.channelId = options.channelId;
    this.autoDispose = false;

    this.setSimulationInterval(() => {
      this.maybeAdvanceAtEnd();
    }, 1000);

    this.onMessage("play", (client, msg: { currentTime?: number }) => {
      if (!this.rateLimit(client) || !this.canControlPlayback(client)) return;
      this.applyPlay(clampTime(msg?.currentTime));
      this.broadcast("play", { currentTime: this.state.currentTime });
    });

    this.onMessage("pause", (client, msg: { currentTime?: number }) => {
      if (!this.rateLimit(client) || !this.canControlPlayback(client)) return;
      this.applyPause(clampTime(msg?.currentTime));
      this.broadcast("pause", { currentTime: this.state.currentTime });
    });

    this.onMessage("seek", (client, msg: { currentTime?: number }) => {
      if (!this.rateLimit(client) || !this.canControlPlayback(client)) return;
      this.applySeek(clampTime(msg?.currentTime));
      this.broadcast("seek", { currentTime: this.state.currentTime });
    });

    this.onMessage("setRate", (client, msg: { rate?: number; currentTime?: number }) => {
      if (!this.rateLimit(client) || !this.canControlPlayback(client)) return;
      this.state.playbackRate = clampPlaybackRate(msg?.rate);
      this.applySeek(clampTime(msg?.currentTime));
      this.broadcast("setRate", {
        rate: this.state.playbackRate,
        currentTime: this.state.currentTime,
      });
    });

    this.onMessage(
      "loadVideo",
      (
        client,
        msg: { videoId?: string; title?: string; durationSec?: number; autoPlay?: boolean }
      ) => {
        if (!this.rateLimit(client) || !this.canEditQueue(client)) return;
        if (!isValidVideoId(msg?.videoId)) return;

        const addedBy = sanitizeUsername(client.auth?.username);
        this.setNowPlaying(
          msg.videoId!,
          sanitizeTitle(msg?.title),
          clampDuration(msg?.durationSec),
          addedBy,
          client.sessionId,
          msg?.autoPlay === true
        );
        this.broadcast("videoChanged", this.buildSyncPayload(0));
      }
    );

    this.onMessage(
      "addToQueue",
      (client, msg: { videoId?: string; title?: string; channelName?: string; durationSec?: number }) => {
        if (!this.rateLimit(client) || !this.canEditQueue(client)) return;
        if (!isValidVideoId(msg?.videoId)) return;

        this.makeRoomInQueue();
        if (this.state.queue.length >= MAX_QUEUE_SIZE) return;

        const item = new QueueItem();
        item.videoId = msg.videoId!;
        item.title = sanitizeTitle(msg?.title);
        item.channelName = sanitizeTitle(msg?.channelName);
        item.addedBy = sanitizeUsername(client.auth?.username);
        item.addedBySessionId = client.sessionId;
        item.durationSec = clampDuration(msg?.durationSec);
        item.status = "queued";
        this.state.queue.push(item);
        this.tryAutostart();
      }
    );

    this.onMessage(
      "addBatchToQueue",
      (
        client,
        msg: {
          items?: { videoId?: string; title?: string; channelName?: string; durationSec?: number }[];
        }
      ) => {
        if (!this.rateLimit(client) || !this.canEditQueue(client)) return;
        if (!Array.isArray(msg?.items)) return;

        const addedBy = sanitizeUsername(client.auth?.username);
        const sessionId = client.sessionId;
        let added = 0;
        for (const entry of msg.items) {
          this.makeRoomInQueue();
          if (this.state.queue.length >= MAX_QUEUE_SIZE) break;
          if (!isValidVideoId(entry?.videoId)) continue;

          const item = new QueueItem();
          item.videoId = entry.videoId!;
          item.title = sanitizeTitle(entry?.title);
          item.channelName = sanitizeTitle(entry?.channelName);
          item.addedBy = addedBy;
          item.addedBySessionId = sessionId;
          item.durationSec = clampDuration(entry?.durationSec);
          item.status = "queued";
          this.state.queue.push(item);
          added += 1;
        }
        if (added > 0) {
          client.send("batchQueued", { count: added });
          this.tryAutostart();
        }
      }
    );

    this.onMessage("removeFromQueue", (client, msg: { index?: number }) => {
      if (!this.rateLimit(client) || !this.canEditQueue(client)) return;
      const index = clampQueueIndex(msg?.index, this.state.queue.length);
      if (index === null) return;
      if (this.state.queue[index].status === "playing") return;
      this.state.queue.splice(index, 1);
    });

    this.onMessage("moveQueueItem", (client, msg: { fromIndex?: number; toIndex?: number }) => {
      if (!this.rateLimit(client) || !this.canEditQueue(client)) return;
      const from = clampQueueIndex(msg?.fromIndex, this.state.queue.length);
      const to = clampQueueIndex(msg?.toIndex, this.state.queue.length);
      if (from === null || to === null || from === to) return;
      const fromStatus = this.state.queue[from].status;
      if (fromStatus !== "queued" && fromStatus !== "played") return;
      if (this.state.queue[to].status === "playing") return;

      const items = [...this.state.queue];
      const [moved] = items.splice(from, 1);
      if (!moved) return;
      const insertAt = from < to ? to - 1 : to;
      items.splice(insertAt, 0, moved);

      this.state.queue.clear();
      for (const entry of items) {
        this.state.queue.push(entry);
      }
    });

    this.onMessage("playNextInQueue", (client, msg: { index?: number }) => {
      if (!this.rateLimit(client) || !this.canEditQueue(client)) return;
      const from = clampQueueIndex(msg?.index, this.state.queue.length);
      if (from === null) return;
      if (this.state.queue[from].status !== "queued") return;

      const items = [...this.state.queue];
      const [moved] = items.splice(from, 1);
      if (!moved) return;

      const playingIdx = items.findIndex((item) => item.status === "playing");
      const insertAt = playingIdx >= 0 ? playingIdx + 1 : 0;
      items.splice(insertAt, 0, moved);

      this.state.queue.clear();
      for (const entry of items) {
        this.state.queue.push(entry);
      }
    });

    this.onMessage("clearQueue", (client) => {
      if (!this.rateLimit(client) || !this.canEditQueue(client)) return;
      const playing = this.state.queue.find((item) => item.status === "playing");
      this.state.queue.clear();
      if (playing) {
        this.state.queue.push(playing);
      }
    });

    this.onMessage("skipVideo", (client) => {
      if (!this.rateLimit(client) || !this.canControlPlayback(client)) return;
      if (!this.advanceQueue(true)) {
        this.markPlayingAsPlayed();
        this.state.videoId = "";
        this.state.videoTitle = "";
        this.state.videoDurationSec = 0;
        this.applyPause(0);
        this.broadcast("queueEmpty", {});
        this.broadcast("videoChanged", this.buildSyncPayload(0));
      }
    });

    this.onMessage("playQueueItem", (client, msg: { index?: number }) => {
      if (!this.rateLimit(client) || !this.canControlPlayback(client)) return;
      const index = clampQueueIndex(msg?.index, this.state.queue.length);
      if (index === null) return;
      this.playQueueItemAt(index, true);
    });

    this.onMessage("videoEnded", (client) => {
      if (!this.rateLimit(client) || !this.canControlPlayback(client)) return;
      this.handleVideoComplete();
    });

    this.onMessage("videoUnavailable", (client, msg: { errorCode?: number }) => {
      if (!this.rateLimit(client)) return;
      if (typeof msg?.errorCode === "number" && msg.errorCode > 0) {
        console.warn(`Skipping unavailable video ${this.state.videoId} (YouTube error ${msg.errorCode})`);
      }
      this.handleVideoUnavailable();
    });

    this.onMessage("setVideoDuration", (client, msg: { durationSec?: number }) => {
      if (!this.rateLimit(client)) return;
      const durationSec = clampDuration(msg?.durationSec);
      if (durationSec <= 0) return;

      if (this.state.videoDurationSec <= 0) {
        this.state.videoDurationSec = durationSec;
      }

      const playing = this.state.queue.find((item) => item.status === "playing");
      if (playing && playing.durationSec <= 0) {
        playing.durationSec = durationSec;
      }
    });

    this.onMessage(
      "setPermissions",
      (
        client,
        msg: {
          allowEveryoneQueue?: boolean;
          allowEveryonePlayback?: boolean;
          allowOthersToHost?: boolean;
          allowReplayPlayed?: boolean;
          dimPlayedInPlaylist?: boolean;
          continueFromPosition?: boolean;
        }
      ) => {
        if (!this.rateLimit(client) || !this.isHost(client)) return;
        if (typeof msg.allowEveryoneQueue === "boolean") {
          this.state.allowEveryoneQueue = msg.allowEveryoneQueue;
        }
        if (typeof msg.allowEveryonePlayback === "boolean") {
          this.state.allowEveryonePlayback = msg.allowEveryonePlayback;
        }
        if (typeof msg.allowOthersToHost === "boolean") {
          this.state.allowOthersToHost = msg.allowOthersToHost;
        }
        if (typeof msg.allowReplayPlayed === "boolean") {
          this.state.allowReplayPlayed = msg.allowReplayPlayed;
        }
        if (typeof msg.dimPlayedInPlaylist === "boolean") {
          this.state.dimPlayedInPlaylist = msg.dimPlayedInPlaylist;
        }
        if (typeof msg.continueFromPosition === "boolean") {
          this.state.continueFromPosition = msg.continueFromPosition;
        }
        this.broadcast("permissionsChanged", this.buildPermissionsPayload());
      }
    );

    this.onMessage("transferHost", (client, msg: { sessionId?: string }) => {
      if (!this.rateLimit(client) || !this.isHost(client)) return;
      if (typeof msg?.sessionId !== "string" || !this.state.members.has(msg.sessionId)) return;
      this.state.hostSessionId = msg.sessionId;
      this.broadcast("hostChanged", { hostSessionId: this.state.hostSessionId });
    });

    this.onMessage("claimHost", (client) => {
      if (!this.rateLimit(client) || this.isHost(client)) return;
      if (!this.state.allowOthersToHost) return;
      this.state.hostSessionId = client.sessionId;
      this.broadcast("hostChanged", { hostSessionId: this.state.hostSessionId });
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
      permissions: this.buildPermissionsPayload(),
    });
  }

  async onLeave(client: Client, code: number) {
    this.lastMessageAt.delete(client.sessionId);

    try {
      if (code === CloseCode.CONSENTED) {
        throw new Error("consented leave");
      }
      await this.allowReconnection(client, 120);
      return;
    } catch {
      /* consented leave or reconnection window expired */
    }

    this.state.members.delete(client.sessionId);

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
