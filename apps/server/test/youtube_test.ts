import assert from "assert";
import {
  sanitizeSearchQuery,
  parsePlaylistId,
  isoDurationToSeconds,
  formatDuration,
  clearYouTubeCache,
} from "../src/services/youtube";
import { checkRateLimit, resetRateLimits } from "../src/utils/rateLimit";

describe("YouTube service utils", () => {
  beforeEach(() => {
    clearYouTubeCache();
    resetRateLimits();
  });

  it("sanitizes search queries", () => {
    assert.strictEqual(sanitizeSearchQuery("  hello  "), "hello");
    assert.strictEqual(sanitizeSearchQuery("a".repeat(200)).length, 100);
    assert.strictEqual(sanitizeSearchQuery("bad\x00query"), "badquery");
  });

  it("parses playlist IDs from URLs", () => {
    assert.strictEqual(parsePlaylistId("PLrAXtmRdnEQy6nuLMH"), "PLrAXtmRdnEQy6nuLMH");
    assert.strictEqual(
      parsePlaylistId("https://www.youtube.com/playlist?list=PLabc123XYZ"),
      "PLabc123XYZ"
    );
    assert.strictEqual(parsePlaylistId("not valid!"), null);
  });

  it("converts ISO durations", () => {
    assert.strictEqual(isoDurationToSeconds("PT4M13S"), 253);
    assert.strictEqual(formatDuration(253), "4:13");
    assert.strictEqual(formatDuration(3661), "1:01:01");
  });

  it("rate limits requests per key", () => {
    assert.strictEqual(checkRateLimit("user1", 2, 60_000), true);
    assert.strictEqual(checkRateLimit("user1", 2, 60_000), true);
    assert.strictEqual(checkRateLimit("user1", 2, 60_000), false);
    assert.strictEqual(checkRateLimit("user2", 2, 60_000), true);
  });
});
