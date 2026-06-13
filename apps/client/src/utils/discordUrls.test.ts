import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isDiscordActivity,
  discordRuntimePath,
  getYouTubeEmbedPostMessageTarget,
  getYouTubeMediaUrl,
} from "./discordUrls.js";
import { buildYouTubeEmbedUrl } from "./youtubeEmbed.js";

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
  });

  it("uses direct youtube.com embed in Discord", () => {
    vi.stubGlobal("window", {
      location: { hostname: "12345.discordsays.com", search: "", origin: "https://12345.discordsays.com", href: "https://12345.discordsays.com/" },
    });
    const url = buildYouTubeEmbedUrl("dQw4w9WgXcQ", 0, true);
    expect(url).toContain("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(url).not.toContain("/api/youtube/player");
    expect(url).not.toContain("youtube-nocookie");
  });

  it("uses youtube.com postMessage target in Discord", () => {
    vi.stubGlobal("window", {
      location: { hostname: "12345.discordsays.com", search: "", origin: "https://12345.discordsays.com" },
    });
    expect(getYouTubeEmbedPostMessageTarget()).toBe("https://www.youtube.com");
  });

  it("uses proxied media stream in Discord", () => {
    vi.stubGlobal("window", {
      location: { hostname: "12345.discordsays.com", search: "", origin: "https://12345.discordsays.com" },
    });
    vi.stubEnv("VITE_COLYSEUS_URL", "/.proxy/colyseus");
    expect(getYouTubeMediaUrl("dQw4w9WgXcQ")).toBe(
      "/.proxy/colyseus/api/youtube/media/dQw4w9WgXcQ"
    );
  });
});
