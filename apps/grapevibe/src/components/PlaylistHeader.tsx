"use client";

import { Icon } from "@iconify/react";
import { playlistModeDescription, playlistModeLabel } from "@/lib/playlist";
import type { RoomSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PlaylistHeaderProps {
  settings: RoomSettings;
  count: number;
  compact?: boolean;
}

export function PlaylistHeader({ settings, count, compact = false }: PlaylistHeaderProps) {
  const mode = settings.playlistMode;

  return (
    <div className={cn("shrink-0 space-y-2", compact ? "mb-2" : "mb-4")}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20",
              compact ? "h-7 w-7" : "h-8 w-8"
            )}
          >
            <Icon icon="mdi:playlist-music" className="text-primary-soft" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Playlist</p>
            <p className="text-[11px] text-muted">
              {count} {count === 1 ? "video" : "videos"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <span className="rounded-lg border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-soft">
            {playlistModeLabel(mode)}
          </span>
          {settings.shuffle && (
            <span
              className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400"
              title="Shuffle enabled"
            >
              <Icon icon="mdi:shuffle" className="inline text-xs" /> Shuffle
            </span>
          )}
        </div>
      </div>
      {!compact && (
        <p className="text-[11px] leading-relaxed text-muted">{playlistModeDescription(mode)}</p>
      )}
    </div>
  );
}
