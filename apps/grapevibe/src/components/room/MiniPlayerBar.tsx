"use client";

import { Icon } from "@iconify/react";
import { formatTime } from "@/lib/format";
import type { VideoItem } from "@/lib/types";

interface MiniPlayerBarProps {
  video: VideoItem;
  title: string;
  currentTime: number;
  duration: number;
  playing: boolean;
  canControlPlayback: boolean;
  onExpand: () => void;
  onTogglePlay: () => void;
}

export function MiniPlayerBar({
  video,
  title,
  currentTime,
  duration,
  playing,
  canControlPlayback,
  onExpand,
  onTogglePlay,
}: MiniPlayerBarProps) {
  const thumb =
    video.thumbnail ||
    (video.videoId ? `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg` : null);

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="glass-strong z-40 shrink-0 border-t border-[var(--border)] shadow-[0_-4px_24px_rgba(0,0,0,0.35)] lg:hidden">
      <div className="progress-track h-[2px] rounded-none">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={onExpand}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div className="relative h-11 w-[4.75rem] shrink-0 overflow-hidden rounded-lg bg-black ring-1 ring-[var(--border)]">
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted">
                <Icon icon="mdi:play-circle-outline" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{title}</p>
            <p className="text-[11px] tabular-nums text-muted">
              {formatTime(currentTime)} / {formatTime(duration)}
            </p>
          </div>
        </button>
        {canControlPlayback ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-primary to-secondary text-white shadow-lg shadow-primary/25 ring-1 ring-white/10 transition active:scale-95"
            aria-label={playing ? "Pause" : "Play"}
          >
            <Icon icon={playing ? "mdi:pause" : "mdi:play"} className="text-lg" />
          </button>
        ) : (
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-muted ring-1 ring-[var(--border)]"
            title="Host controls playback"
          >
            <Icon icon={playing ? "mdi:equalizer" : "mdi:pause"} className="text-lg" />
          </div>
        )}
      </div>
    </div>
  );
}
