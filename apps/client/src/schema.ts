import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

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
