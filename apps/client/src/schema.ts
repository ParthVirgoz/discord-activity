import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export type GamePhase = "lobby" | "submit" | "vote" | "reveal" | "ended";

export class Member extends Schema {
  @type("string") username = "";
  @type("string") avatarUrl = "";
  @type("string") discordId = "";
}

export class VoteOption extends Schema {
  @type("string") id = "";
  @type("string") text = "";
}

export class PlayerScore extends Schema {
  @type("number") points = 0;
}

export class GameRoomState extends Schema {
  @type({ map: Member }) members = new MapSchema<Member>();
  @type("string") phase: GamePhase = "lobby";
  @type("string") hostSessionId = "";
  @type("number") round = 0;
  @type("number") maxRounds = 5;
  @type("string") prompt = "";
  @type({ array: VoteOption }) options = new ArraySchema<VoteOption>();
  @type({ map: PlayerScore }) scores = new MapSchema<PlayerScore>();
  @type("number") submittedCount = 0;
  @type("number") votedCount = 0;
  @type("number") phaseEndsAt = 0;
  @type("string") channelId = "";
  @type("string") truthOptionId = "";
}
