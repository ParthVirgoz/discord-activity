import assert from "assert";
import { buildYouTubePlayerPage, parsePlayerQuery } from "../src/services/youtubePlayerPage";

describe("youtubePlayerPage", () => {
  it("builds wrapper HTML with direct youtube.com embed", () => {
    const html = buildYouTubePlayerPage("dQw4w9WgXcQ", {
      startSec: 10,
      autoplay: true,
      origin: "https://123.discordsays.com",
    });
    assert.ok(html.includes("www.youtube.com/embed/dQw4w9WgXcQ"));
    assert.ok(html.includes("autoplay=1"));
    assert.ok(html.includes("parent.postMessage"));
  });

  it("parses player query params", () => {
    const parsed = parsePlayerQuery({
      start: "30",
      autoplay: "1",
      origin: "https://123.discordsays.com",
    });
    assert.strictEqual(parsed.startSec, 30);
    assert.strictEqual(parsed.autoplay, true);
    assert.strictEqual(parsed.origin, "https://123.discordsays.com");
  });
});
