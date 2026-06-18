"use client";

import { Icon } from "@iconify/react";
import { cn } from "@/lib/utils";

export type PhoneTab = "watch" | "discover" | "playlist";
export type TabletTab = "room" | "discover";
export type RoomTab = PhoneTab | TabletTab;

interface RoomTabBarProps {
  mode: "phone" | "tablet" | "mobile";
  active: RoomTab;
  onChange: (tab: RoomTab) => void;
  queueCount: number;
}

const PHONE_TABS: { id: PhoneTab; label: string; icon: string }[] = [
  { id: "watch", label: "Watch", icon: "mdi:play-circle" },
  { id: "discover", label: "Discover", icon: "mdi:magnify" },
  { id: "playlist", label: "Playlist", icon: "mdi:playlist-music" },
];

const TABLET_TABS: { id: TabletTab; label: string; icon: string }[] = [
  { id: "room", label: "Room", icon: "mdi:television" },
  { id: "discover", label: "Discover", icon: "mdi:magnify" },
];

export function RoomTabBar({ mode, active, onChange, queueCount }: RoomTabBarProps) {
  const tabs = mode === "tablet" ? TABLET_TABS : PHONE_TABS;

  return (
    <nav
      className={cn(
        "glass-strong relative z-40 shrink-0 border-t pb-[env(safe-area-inset-bottom)]",
        mode === "phone" && "md:hidden",
        mode === "tablet" && "hidden md:flex lg:hidden",
        mode === "mobile" && "flex lg:hidden"
      )}
      aria-label="Room sections"
    >
      <div className="mx-auto flex w-full max-w-lg px-2 pt-1.5">
        {tabs.map((tab) => {
          const isActive = active === tab.id;
          const showBadge =
            (tab.id === "playlist" || tab.id === "room") && queueCount > 0;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] font-semibold transition-all duration-200",
                isActive ? "text-foreground" : "text-muted hover:text-foreground/80"
              )}
            >
              {isActive && (
                <span className="absolute inset-x-2 inset-y-1 -z-10 rounded-xl bg-primary/15 ring-1 ring-primary/20" />
              )}
              <Icon icon={tab.icon} className={cn("text-[1.35rem]", isActive && "text-primary-soft")} />
              <span>{tab.label}</span>
              {showBadge && (
                <span className="absolute right-[calc(50%-1.5rem)] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white shadow-sm">
                  {queueCount > 99 ? "99+" : queueCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function normalizeTabForMode(tab: RoomTab, mode: "phone" | "tablet"): RoomTab {
  if (mode === "phone") {
    if (tab === "room") return "watch";
    if (tab === "watch" || tab === "discover" || tab === "playlist") return tab;
    return "watch";
  }
  if (tab === "watch" || tab === "playlist") return "room";
  if (tab === "room" || tab === "discover") return tab;
  return "room";
}
