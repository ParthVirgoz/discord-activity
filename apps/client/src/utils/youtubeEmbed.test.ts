import { describe, it, expect, vi, afterEach } from "vitest";
import { isRawIpHost, buildYouTubeEmbedUrl } from "./youtubeEmbed.js";

describe("isRawIpHost", () => {
  it("detects IPv4 hosts", () => {
    expect(isRawIpHost("192.168.1.5")).toBe(true);
    expect(isRawIpHost("10.0.0.1")).toBe(true);
  });

  it("allows localhost and domain names", () => {
    expect(isRawIpHost("localhost")).toBe(false);
    expect(isRawIpHost("synctube.vercel.app")).toBe(false);
  });
});

describe("buildYouTubeEmbedUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses server player wrapper in Discord", () => {
    vi.stubGlobal("window", {
      location: { hostname: "123.discordsays.com", search: "", origin: "https://123.discordsays.com", href: "https://123.discordsays.com/" },
    });
    vi.stubEnv("VITE_COLYSEUS_URL", "/.proxy/colyseus");
    const url = buildYouTubeEmbedUrl("dQw4w9WgXcQ", 0, true);
    expect(url).toContain("/.proxy/colyseus/api/youtube/player/dQw4w9WgXcQ");
    expect(url).toContain("autoplay=1");
    expect(url).toContain("origin=");
  });

  it("supports youtube-nocookie embed host outside Discord", () => {
    vi.stubGlobal("window", {
      location: { hostname: "localhost", search: "", origin: "http://localhost:5173", href: "http://localhost:5173/" },
    });
    const url = buildYouTubeEmbedUrl(
      "dQw4w9WgXcQ",
      0,
      true,
      "nocookie",
      "https://example.com",
      "https://example.com/"
    );
    expect(url).toContain("youtube-nocookie.com");
  });

  it("includes origin, widget_referrer, and enablejsapi", () => {
    vi.stubGlobal("window", {
      location: { hostname: "localhost", search: "", origin: "https://synctube.vercel.app", href: "https://synctube.vercel.app/" },
    });
    const url = buildYouTubeEmbedUrl("dQw4w9WgXcQ", 0, true, "youtube", "https://synctube.vercel.app", "https://synctube.vercel.app/");
    expect(url).toContain("enablejsapi=1");
    expect(url).toContain("origin=https%3A%2F%2Fsynctube.vercel.app");
    expect(url).toContain("widget_referrer=");
    expect(url).toContain("autoplay=1");
  });
});
