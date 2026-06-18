"use client";

import { useEffect, useState } from "react";

export type RoomLayoutMode = "phone" | "tablet" | "desktop";

const QUERIES = {
  desktop: "(min-width: 1024px)",
  tablet: "(min-width: 768px)",
} as const;

export function useRoomLayoutMode(): RoomLayoutMode {
  const [mode, setMode] = useState<RoomLayoutMode>("desktop");

  useEffect(() => {
    const desktop = window.matchMedia(QUERIES.desktop);
    const tablet = window.matchMedia(QUERIES.tablet);

    const update = () => {
      if (desktop.matches) setMode("desktop");
      else if (tablet.matches) setMode("tablet");
      else setMode("phone");
    };

    update();
    desktop.addEventListener("change", update);
    tablet.addEventListener("change", update);
    return () => {
      desktop.removeEventListener("change", update);
      tablet.removeEventListener("change", update);
    };
  }, []);

  return mode;
}
