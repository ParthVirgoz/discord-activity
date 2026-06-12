import { describe, it, expect } from "vitest";
import { getYouTubeErrorMessage } from "./youtubeErrors.js";

describe("getYouTubeErrorMessage", () => {
  it("returns known error messages", () => {
    expect(getYouTubeErrorMessage(101)).toContain("embedding");
    expect(getYouTubeErrorMessage(100)).toContain("private");
  });

  it("returns fallback for unknown codes", () => {
    expect(getYouTubeErrorMessage(999)).toContain("999");
  });
});
