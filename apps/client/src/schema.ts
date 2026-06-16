import { Schema, type, MapSchema } from "@colyseus/schema";

export type UnoPhase = "lobby" | "playing" | "finished";

export class Member extends Schema {
  @type("string") username = "";
  @type("string") avatarUrl = "";
  @type("string") discordId = "";
}

export class TopCard extends Schema {
  @type("string") id = "";
  @type("string") color = "";
  @type("string") value = "";
}

export class UnoRoomState extends Schema {
  @type({ map: Member }) members = new MapSchema<Member>();
  @type({ map: "number" }) handCounts = new MapSchema<number>();
  @type("string") phase: UnoPhase = "lobby";
  @type("string") gameMode = "";
  @type("string") hostSessionId = "";
  @type("string") currentPlayerId = "";
  @type("number") direction = 1;
  @type("string") currentColor = "";
  @type(TopCard) topCard = new TopCard();
  @type("number") drawStack = 0;
  @type("string") statusMessage = "";
  @type("string") winnerSessionId = "";
  @type("string") unoWatchSessionId = "";
  @type("number") deckRemaining = 0;
  @type("string") channelId = "";
}

/** @deprecated alias for join helpers */
export type GameRoomState = UnoRoomState;
