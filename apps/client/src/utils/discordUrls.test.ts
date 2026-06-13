import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isDiscordActivity,
  discordRuntimePath,
  getYouTubeEmbedPostMessageTarget,
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

  it("uses server player wrapper URL in Discord", () => {
    vi.stubGlobal("window", {
      location: { hostname: "12345.discordsays.com", search: "", origin: "https://12345.discordsays.com", href: "https://12345.discordsays.com/" },
    });
    vi.stubEnv("VITE_COLYSEUS_URL", "/.proxy/colyseus");
    const url = buildYouTubeEmbedUrl("dQw4w9WgXcQ", 0, true);
    expect(url).toContain("/.proxy/colyseus/api/youtube/player/dQw4w9WgXcQ");
    expect(url).not.toContain("youtube-nocookie");
  });

  it("uses direct postMessage target in Discord", () => {
    const origin = "https://12345.discordsays.com";
    vi.stubGlobal("window", {
      location: { hostname: "12345.discordsays.com", search: "", origin },
    });
    expect(getYouTubeEmbedPostMessageTarget(origin)).toBe(origin);
  });
});
