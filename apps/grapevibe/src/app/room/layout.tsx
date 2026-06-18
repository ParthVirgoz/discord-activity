import type { Metadata } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Join Watch Party Room",
  description: `Join a ${APP_NAME} room. ${APP_TAGLINE}`,
  openGraph: {
    title: `Join a ${APP_NAME} Room`,
    description: APP_TAGLINE,
  },
};

export default function RoomLayout({ children }: { children: React.ReactNode }) {
  return children;
}
