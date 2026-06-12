import { describe, it, expect } from "vitest";
import { parseYouTubeId, isValidVideoId, parsePlaylistId } from "./youtube.js";

describe("parseYouTubeId", () => {
  it("parses bare video IDs", () => {
    expect(parseYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("parses watch URLs", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("parses short URLs", () => {
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("parses shorts URLs", () => {
    expect(parseYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("rejects invalid input", () => {
    expect(parseYouTubeId("")).toBeNull();
    expect(parseYouTubeId("not-a-url")).toBeNull();
    expect(parseYouTubeId("javascript:alert(1)")).toBeNull();
  });

  it("validates video ID format", () => {
    expect(isValidVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(isValidVideoId("bad")).toBe(false);
  });

  it("parses playlist URLs", () => {
    expect(parsePlaylistId("https://www.youtube.com/playlist?list=PLabc123XYZ")).toBe("PLabc123XYZ");
    expect(parsePlaylistId("PLabc123XYZ")).toBe("PLabc123XYZ");
    expect(parsePlaylistId("not valid!")).toBeNull();
  });
});
