/** Public product brand & SEO */
export const APP_NAME = "Grapevibe";
export const APP_TAGLINE = "Watch together. Same bunch, same sync.";
export const APP_DESCRIPTION =
  "Grapevibe is a free watch party app to watch YouTube together with friends. Sync playback in real time — no account, no install. Create a room, share the link, and stay in the same bunch.";
export const APP_SHORT_DESCRIPTION =
  "Free YouTube watch party with synced playback for friends.";
export const APP_KEYWORDS = [
  "grapevibe",
  "watch youtube together",
  "watch party",
  "youtube watch party",
  "sync video",
  "watch together online",
  "group watch",
  "teleparty alternative",
  "watch videos with friends",
  "free watch party",
];
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://grapevibe.vercel.app";
export const APP_THEME_COLOR = "#7c3aed";
export const APP_BACKGROUND = "#0f172a";

export const APP_TITLE =
  "Grapevibe — Watch YouTube Together | Free Watch Party";
export const APP_OG_TITLE = "Grapevibe — Watch YouTube Together";
export const APP_TWITTER_TITLE = "Grapevibe | Free YouTube Watch Party";

export function appJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: APP_NAME,
    description: APP_DESCRIPTION,
    url: APP_URL,
    applicationCategory: "EntertainmentApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "Synchronized YouTube playback",
      "Instant watch party rooms",
      "Shared playlist queue",
      "No sign-up required",
    ],
  };
}
