import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isDiscordActivity,
  getServerProxyPrefix,
  getYouTubeEmbedBase,
  getYouTubeThumbnailUrl,
  getYouTubeEmbedMessageOrigins,
  getYouTubeEmbedPostMessageTarget,
} from "./discordUrls.js";

describe("discordUrls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects Discord activity host", () => {
    expect(isDiscordActivity("12345.discordsays.com", "")).toBe(true);
    expect(isDiscordActivity("localhost", "?frame_id=abc")).toBe(true);
    expect(isDiscordActivity("localhost", "")).toBe(false);
  });

  it("uses proxied paths in Discord", () => {
    vi.stubGlobal("window", {
      location: { hostname: "12345.discordsays.com", search: "", origin: "https://12345.discordsays.com" },
    });
    expect(getServerProxyPrefix()).toBe("/colyseus");
    expect(getYouTubeEmbedBase()).toBe("/youtube-nocookie");
    expect(getYouTubeThumbnailUrl("dQw4w9WgXcQ")).toBe(
      "/colyseus/api/youtube/thumbnail/dQw4w9WgXcQ"
    );
  });

  it("uses direct URLs outside Discord", () => {
    vi.stubGlobal("window", {
      location: { hostname: "localhost", search: "", origin: "http://localhost:5173" },
    });
    expect(getServerProxyPrefix()).toMatch(/\/colyseus$/);
    expect(getYouTubeEmbedBase()).toBe("https://www.youtube-nocookie.com");
    expect(getYouTubeThumbnailUrl("dQw4w9WgXcQ")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    );
  });

  it("includes Discord origin for YouTube postMessage", () => {
    const origin = "https://12345.discordsays.com";
    expect(getYouTubeEmbedMessageOrigins(origin)).toContain(origin);
    expect(getYouTubeEmbedPostMessageTarget(origin)).toBe(
      "https://www.youtube-nocookie.com"
    );

    vi.stubGlobal("window", {
      location: { hostname: "12345.discordsays.com", search: "", origin },
    });
    expect(getYouTubeEmbedPostMessageTarget(origin)).toBe(origin);
  });
});
