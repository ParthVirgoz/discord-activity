import { ImageResponse } from "next/og";
import { GRAPE_GRADIENT, GrapeMark } from "@/lib/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: GRAPE_GRADIENT,
          borderRadius: 40,
        }}
      >
        <GrapeMark size={108} />
      </div>
    ),
    { ...size }
  );
}
