import { describe, it, expect } from "vitest";
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
  it("includes origin, widget_referrer, and enablejsapi", () => {
    const url = buildYouTubeEmbedUrl("dQw4w9WgXcQ", 0, true, "youtube", "https://synctube.vercel.app", "https://synctube.vercel.app/");
    expect(url).toContain("enablejsapi=1");
    expect(url).toContain("origin=https%3A%2F%2Fsynctube.vercel.app");
    expect(url).toContain("widget_referrer=");
    expect(url).toContain("autoplay=1");
  });
});
