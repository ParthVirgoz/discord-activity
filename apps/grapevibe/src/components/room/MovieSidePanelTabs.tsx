"use client";

import { Icon } from "@iconify/react";
import { cn } from "@/lib/utils";

export type MovieSideTab = "discover" | "playlist";

interface MovieSidePanelTabsProps {
  active: MovieSideTab;
  onChange: (tab: MovieSideTab) => void;
  queueCount: number;
}

const TABS: { id: MovieSideTab; label: string; icon: string }[] = [
  { id: "discover", label: "Search", icon: "mdi:youtube" },
  { id: "playlist", label: "Playlist", icon: "mdi:playlist-music" },
];

export function MovieSidePanelTabs({ active, onChange, queueCount }: MovieSidePanelTabsProps) {
  return (
    <div
      className="flex shrink-0 gap-1 border-b border-[var(--border)] bg-surface/80 px-3 py-2 backdrop-blur-sm"
      role="tablist"
      aria-label="Search and playlist"
    >
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all",
              isActive
                ? "bg-primary/15 text-foreground ring-1 ring-primary/25"
                : "text-muted hover:bg-white/[0.04] hover:text-foreground"
            )}
          >
            <Icon icon={tab.icon} className={cn("text-lg", isActive && "text-primary-soft")} />
            {tab.label}
            {tab.id === "playlist" && queueCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                {queueCount > 99 ? "99+" : queueCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
