import assert from "assert";
import {
  isValidChannelId,
  isValidVideoId,
  sanitizeTitle,
  clampTime,
  clampPlaybackRate,
  clampQueueIndex,
} from "../src/utils/validation";

describe("validation utils", () => {
  it("accepts valid Discord channel IDs", () => {
    assert.strictEqual(isValidChannelId("123456789012345678"), true);
    assert.strictEqual(isValidChannelId("abc"), false);
    assert.strictEqual(isValidChannelId(""), false);
  });

  it("accepts valid YouTube video IDs", () => {
    assert.strictEqual(isValidVideoId("dQw4w9WgXcQ"), true);
    assert.strictEqual(isValidVideoId("short"), false);
    assert.strictEqual(isValidVideoId("invalid!id!!"), false);
  });

  it("sanitizes titles", () => {
    assert.strictEqual(sanitizeTitle("  hello  "), "hello");
    assert.strictEqual(sanitizeTitle("x".repeat(300)).length, 200);
  });

  it("clamps time values", () => {
    assert.strictEqual(clampTime(-5), 0);
    assert.strictEqual(clampTime(NaN), 0);
    assert.strictEqual(clampTime(42.5), 42.5);
  });

  it("clamps playback rate", () => {
    assert.strictEqual(clampPlaybackRate(0.1), 0.25);
    assert.strictEqual(clampPlaybackRate(5), 2);
    assert.strictEqual(clampPlaybackRate(1), 1);
  });

  it("validates queue indices", () => {
    assert.strictEqual(clampQueueIndex(0, 3), 0);
    assert.strictEqual(clampQueueIndex(3, 3), null);
    assert.strictEqual(clampQueueIndex(-1, 3), null);
  });
});
