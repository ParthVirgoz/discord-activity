"use client";

import type { SearchResultItem, VideoItem } from "@/lib/types";
import { Icon } from "@iconify/react";

interface VideoCardGridProps {
  items: Array<SearchResultItem | VideoItem>;
  canAdd?: boolean;
  canPlayNow?: boolean;
  onQueue?: (payload: Record<string, string>) => void;
  onPlay?: (payload: Record<string, string>) => void;
  onPlayQueueItem?: (itemId: string) => void;
  onRemoveQueueItem?: (itemId: string) => void;
  mode: "search" | "queue";
}

function searchPayload(item: SearchResultItem): Record<string, string> {
  const payload: Record<string, string> = {
    source: "youtube",
    videoId: item.videoId,
    title: item.title,
    thumbnail: item.thumbnail,
  };
  if (item.channel) payload.channel = item.channel;
  return payload;
}

export function VideoCardGrid({
  items,
  canAdd = false,
  canPlayNow = false,
  onQueue,
  onPlay,
  onPlayQueueItem,
  onRemoveQueueItem,
  mode,
}: VideoCardGridProps) {
  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const isSearch = mode === "search";
        const searchItem = item as SearchResultItem;
        const queueItem = item as VideoItem;
        const key = isSearch ? searchItem.videoId : queueItem.id;
        const thumb =
          (isSearch ? searchItem.thumbnail : queueItem.thumbnail) ||
          (searchItem.videoId
            ? `https://i.ytimg.com/vi/${searchItem.videoId}/mqdefault.jpg`
            : undefined);
        const title = item.title;
        const subtitle = isSearch
          ? [searchItem.channel, searchItem.duration].filter(Boolean).join(" · ")
          : queueItem.source === "youtube"
            ? "YouTube"
            : "Direct";

        return (
          <article
            key={key}
            className="group flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-surface-elevated/50 transition-all duration-200 hover:border-primary/25 hover:shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)]"
          >
            <div className="relative aspect-video w-full bg-black">
              {thumb ? (
                <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full items-center justify-center text-muted">
                  <Icon icon="mdi:file-video" className="text-3xl opacity-40" />
                </div>
              )}
              {(canAdd || canPlayNow) && (
                <div className="absolute inset-0 flex items-center justify-center gap-2.5 bg-black/55 opacity-0 backdrop-blur-[2px] transition duration-200 group-hover:opacity-100">
                  {isSearch ? (
                    <>
                      {canAdd && (
                        <button
                          type="button"
                          title="Queue"
                          onClick={() => onQueue?.(searchPayload(searchItem))}
                          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-primary hover:ring-primary/50"
                        >
                          <Icon icon="mdi:playlist-plus" className="text-lg" />
                        </button>
                      )}
                      {canPlayNow && (
                        <button
                          type="button"
                          title="Play now"
                          onClick={() => onPlay?.(searchPayload(searchItem))}
                          className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-primary to-secondary text-white shadow-lg shadow-primary/30 ring-1 ring-white/10"
                        >
                          <Icon icon="mdi:play" className="text-lg" />
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        title="Play"
                        onClick={() => onPlayQueueItem?.(queueItem.id)}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-primary to-secondary text-white shadow-lg shadow-primary/30"
                      >
                        <Icon icon="mdi:play" className="text-lg" />
                      </button>
                      <button
                        type="button"
                        title="Remove"
                        onClick={() => onRemoveQueueItem?.(queueItem.id)}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/90 text-white"
                      >
                        <Icon icon="mdi:close" className="text-lg" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="p-2.5">
              <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground">{title}</p>
              {subtitle && (
                <p className="mt-1 truncate text-[10px] text-muted">{subtitle}</p>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
