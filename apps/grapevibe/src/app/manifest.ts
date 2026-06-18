import type { MetadataRoute } from "next";
import {
  APP_BACKGROUND,
  APP_NAME,
  APP_SHORT_DESCRIPTION,
  APP_TAGLINE,
  APP_THEME_COLOR,
  APP_URL,
} from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — ${APP_TAGLINE}`,
    short_name: APP_NAME,
    description: APP_SHORT_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: APP_BACKGROUND,
    theme_color: APP_THEME_COLOR,
    categories: ["entertainment", "social"],
    lang: "en",
    dir: "ltr",
    id: "/",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    screenshots: [],
  };
}
