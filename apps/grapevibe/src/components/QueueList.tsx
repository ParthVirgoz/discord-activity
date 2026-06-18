"use client";

import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import type { VideoItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface QueueListProps {
  items: VideoItem[];
  nowPlayingId?: string | null;
  canReorder: boolean;
  canPlay: boolean;
  compact?: boolean;
  onPlay: (itemId: string) => void;
  onPlayNext: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onMoveUp: (itemId: string) => void;
  onMoveDown: (itemId: string) => void;
  onClear: () => void;
}

export function QueueList({
  items,
  nowPlayingId,
  canReorder,
  canPlay,
  compact = false,
  onPlay,
  onPlayNext,
  onRemove,
  onMoveUp,
  onMoveDown,
  onClear,
}: QueueListProps) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[10rem] flex-1 flex-col items-center justify-center py-6 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.03] ring-1 ring-[var(--border)]">
          <Icon icon="mdi:playlist-music" className="text-xl text-muted" />
        </div>
        <p className="text-sm text-muted">Queue is empty</p>
        <p className="mt-1 text-xs text-muted/70">Add videos from Discover</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {canReorder && items.length > 0 && (
        <div className="mb-2 flex justify-end">
          <Button size="sm" variant="ghost" className="h-7 text-[11px] text-red-400 hover:text-red-300" onClick={onClear}>
            <Icon icon="mdi:playlist-remove" />
            Clear queue
          </Button>
        </div>
      )}
      <ul className="space-y-1.5">
        {items.map((item, index) => {
          const isPlaying = nowPlayingId === item.id;
          return (
            <li
              key={item.id}
              className={cn(
                "group flex min-w-0 items-center rounded-xl border transition-all duration-200",
                compact ? "gap-1.5 px-2 py-1.5" : "gap-2.5 px-2.5 py-2",
                isPlaying
                  ? "border-primary/30 bg-primary/10 shadow-[0_0_20px_-8px_var(--glow)]"
                  : "border-transparent bg-white/[0.02] hover:border-[var(--border)] hover:bg-white/[0.04]"
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center text-[10px] tabular-nums",
                  isPlaying ? "text-primary-soft" : "text-muted"
                )}
              >
                {isPlaying ? <Icon icon="mdi:equalizer" className="text-sm" /> : index + 1}
              </span>
              {item.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnail}
                  alt=""
                  className={cn(
                    "shrink-0 rounded-lg object-cover ring-1 ring-[var(--border)]",
                    compact ? "h-9 w-14" : "h-10 w-[3.75rem]"
                  )}
                />
              ) : (
                <div
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-lg bg-surface-elevated ring-1 ring-[var(--border)]",
                    compact ? "h-9 w-14" : "h-10 w-[3.75rem]"
                  )}
                >
                  <Icon icon="mdi:movie-open" className="text-muted" />
                </div>
              )}
              <button
                type="button"
                className={cn(
                  "min-w-0 flex-1 text-left text-xs leading-snug",
                  canPlay ? "cursor-pointer hover:text-primary-soft" : "cursor-default"
                )}
                onClick={() => canPlay && onPlay(item.id)}
                title={canPlay ? "Play now" : item.title}
              >
                <span className="line-clamp-2 font-medium">{item.title}</span>
              </button>
              <div
                className={cn(
                  "flex shrink-0 items-center opacity-70 transition group-hover:opacity-100",
                  compact ? "gap-0" : "gap-0.5"
                )}
              >
                {canPlay && (
                  <button
                    type="button"
                    title="Play now"
                    onClick={() => onPlay(item.id)}
                    className={cn(
                      "rounded-lg text-muted transition hover:bg-white/[0.06] hover:text-primary-soft",
                      compact ? "p-1" : "p-1.5"
                    )}
                  >
                    <Icon icon="mdi:play" className={compact ? "text-xs" : "text-sm"} />
                  </button>
                )}
                {canReorder && (
                  <>
                    <button
                      type="button"
                      title="Play next"
                      onClick={() => onPlayNext(item.id)}
                      className={cn(
                        "rounded-lg text-muted transition hover:bg-white/[0.06] hover:text-emerald-400",
                        compact ? "p-1" : "p-1.5"
                      )}
                    >
                      <Icon icon="mdi:skip-forward" className={compact ? "text-xs" : "text-sm"} />
                    </button>
                    {!compact && (
                      <>
                        <button
                          type="button"
                          title="Move up"
                          disabled={index === 0}
                          onClick={() => onMoveUp(item.id)}
                          className="rounded-lg p-1.5 text-muted transition hover:bg-white/[0.06] disabled:opacity-30"
                        >
                          <Icon icon="mdi:chevron-up" className="text-sm" />
                        </button>
                        <button
                          type="button"
                          title="Move down"
                          disabled={index === items.length - 1}
                          onClick={() => onMoveDown(item.id)}
                          className="rounded-lg p-1.5 text-muted transition hover:bg-white/[0.06] disabled:opacity-30"
                        >
                          <Icon icon="mdi:chevron-down" className="text-sm" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => onRemove(item.id)}
                      className={cn(
                        "rounded-lg text-muted transition hover:bg-red-500/10 hover:text-red-400",
                        compact ? "p-1" : "p-1.5"
                      )}
                    >
                      <Icon icon="mdi:close" className={compact ? "text-xs" : "text-sm"} />
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
