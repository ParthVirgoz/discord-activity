import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

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
  @type("boolean") continueFromPosition = true;
  @type({ array: QueueItem }) queue = new ArraySchema<QueueItem>();
  @type({ map: Member }) members = new MapSchema<Member>();
}
