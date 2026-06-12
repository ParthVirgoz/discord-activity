import { Schema, type, MapSchema } from "@colyseus/schema";

export class Vec2 extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
}

export class Player extends Schema {
  @type("string") username = "";
  @type("number") heroType = 0;
  @type(Vec2) position = new Vec2();
}

export class MyRoomState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
