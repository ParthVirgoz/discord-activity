import { ImageResponse } from "next/og";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { GRAPE_GRADIENT, GrapeMark } from "@/lib/brand-mark";

export const alt = `${APP_NAME} — ${APP_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 48,
          padding: 64,
          background: "linear-gradient(160deg, #0f172a 0%, #312e81 55%, #1e1b4b 100%)",
          color: "white",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 200,
            height: 200,
            borderRadius: 48,
            background: GRAPE_GRADIENT,
          }}
        >
          <GrapeMark size={120} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 720 }}>
          <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: -2 }}>{APP_NAME}</div>
          <div style={{ fontSize: 34, fontWeight: 600, color: "#ddd6fe", marginTop: 16, lineHeight: 1.3 }}>
            {APP_TAGLINE}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
