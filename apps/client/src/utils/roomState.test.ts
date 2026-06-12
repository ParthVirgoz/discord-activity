import { describe, it, expect } from "vitest";
import { isWatchTogetherRoom } from "./roomState.js";

describe("isWatchTogetherRoom", () => {
  it("rejects legacy game state with players only", () => {
    const room = {
      state: { players: new Map(), members: undefined, queue: undefined },
    };
    expect(isWatchTogetherRoom(room as never)).toBe(false);
  });

  it("accepts watch together state", () => {
    const members = { forEach: () => {} };
    const queue = { forEach: () => {} };
    const room = { state: { members, queue, hostSessionId: "x" } };
    expect(isWatchTogetherRoom(room as never)).toBe(true);
  });
});
