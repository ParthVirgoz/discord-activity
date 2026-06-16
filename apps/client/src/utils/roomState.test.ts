import { describe, it, expect } from "vitest";
import { isGameRoom } from "./roomState.js";

describe("isGameRoom", () => {
  it("rejects legacy watch state with queue", () => {
    const room = {
      state: { members: { forEach: () => {} }, queue: { forEach: () => {} }, handCounts: {}, topCard: {} },
    };
    expect(isGameRoom(room as never)).toBe(false);
  });

  it("rejects legacy bluff state with options", () => {
    const room = {
      state: { members: { forEach: () => {} }, options: [], handCounts: {}, topCard: {} },
    };
    expect(isGameRoom(room as never)).toBe(false);
  });

  it("accepts UNO room state", () => {
    const members = { forEach: () => {} };
    const handCounts = { forEach: () => {} };
    const topCard = { color: "r", value: "5" };
    const room = { state: { members, handCounts, topCard, hostSessionId: "x" } };
    expect(isGameRoom(room as never)).toBe(true);
  });
});
