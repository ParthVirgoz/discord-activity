import { ImageResponse } from "next/og";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { GRAPE_GRADIENT_SOFT, GrapeMark } from "@/lib/brand-mark";

export const alt = `${APP_NAME} — ${APP_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: GRAPE_GRADIENT_SOFT,
          color: "white",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 96,
              height: 96,
              borderRadius: 24,
              background: "linear-gradient(135deg, #7c3aed 0%, #9333ea 55%, #16a34a 100%)",
            }}
          >
            <GrapeMark size={58} />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -2 }}>{APP_NAME}</div>
            <div style={{ fontSize: 28, color: "#c4b5fd", marginTop: 4 }}>Free YouTube watch party</div>
          </div>
        </div>

        <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.25, maxWidth: 900 }}>
          {APP_TAGLINE}
        </div>

        <div style={{ display: "flex", gap: 16, fontSize: 22, color: "#a5b4fc" }}>
          <span>No sign-up</span>
          <span>·</span>
          <span>Synced playback</span>
          <span>·</span>
          <span>Shared playlist</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
