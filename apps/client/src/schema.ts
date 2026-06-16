import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export type GamePhase = "waiting" | "playing" | "finished";

export class Member extends Schema {
  @type("string") username = "";
  @type("string") avatarUrl = "";
  @type("string") discordId = "";
}

export class GameRoomState extends Schema {
  @type({ map: Member }) members = new MapSchema<Member>();
  @type(["string"]) board = new ArraySchema<string>();
  @type("string") phase: GamePhase = "waiting";
  @type("string") currentTurnSessionId = "";
  @type("string") playerXSessionId = "";
  @type("string") playerOSessionId = "";
  @type("string") winner = "";
  @type("string") channelId = "";
}
