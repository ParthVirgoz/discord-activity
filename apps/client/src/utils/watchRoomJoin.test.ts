import { describe, it, expect } from "vitest";
import { WATCH_ROOM_NAME } from "./watchRoomJoin.js";

describe("watchRoomJoin", () => {
  it("uses a single room name matching production server", () => {
    expect(WATCH_ROOM_NAME).toBe("my_room");
  });
});
