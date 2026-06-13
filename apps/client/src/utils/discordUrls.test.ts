import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isDiscordActivity,
  discordRuntimePath,
  getServerProxyPrefix,
  getYouTubeEmbedBase,
  getYouTubeThumbnailUrl,
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

  it("maps portal paths to /.proxy runtime paths in Discord", () => {
    vi.stubGlobal("window", {
      location: { hostname: "12345.discordsays.com", search: "", origin: "https://12345.discordsays.com" },
    });
    expect(discordRuntimePath("/colyseus")).toBe("/.proxy/colyseus");
    expect(discordRuntimePath("/youtube-nocookie")).toBe("/.proxy/youtube-nocookie");
    expect(getYouTubeEmbedBase()).toBe("/.proxy/youtube-nocookie");
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

  it("uses wildcard postMessage target in Discord", () => {
    vi.stubGlobal("window", {
      location: { hostname: "12345.discordsays.com", search: "", origin: "https://12345.discordsays.com" },
    });
    expect(getYouTubeEmbedPostMessageTarget()).toBe("*");
  });
});
