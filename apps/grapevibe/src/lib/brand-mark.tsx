/** Shared grape mark for favicons & OG images (next/og ImageResponse). */
export const GRAPE_GRADIENT = "linear-gradient(135deg, #7c3aed 0%, #9333ea 52%, #16a34a 100%)";
export const GRAPE_GRADIENT_SOFT = "linear-gradient(160deg, #1e1b4b 0%, #312e81 40%, #0f172a 100%)";

export function GrapeMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="8.5" cy="10" r="3.25" fill="white" />
      <circle cx="14.5" cy="10" r="3.25" fill="white" />
      <circle cx="11.5" cy="14.5" r="3.25" fill="white" />
      <circle cx="6.5" cy="13.5" r="2.75" fill="white" fillOpacity="0.92" />
      <circle cx="16.5" cy="13.5" r="2.75" fill="white" fillOpacity="0.92" />
      <path d="M11.5 17.5v4" stroke="white" strokeWidth="1.75" strokeLinecap="round" />
      <path
        d="M11.5 17.5c0-2.5 0-4.5 2.25-6.25"
        stroke="#86efac"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
