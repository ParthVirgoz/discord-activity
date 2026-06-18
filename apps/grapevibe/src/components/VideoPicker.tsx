"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { VideoCardGrid } from "@/components/VideoCardGrid";
import { classifyBrowseInput, parseVideoUrl } from "@/lib/video";
import { apiUrl } from "@/lib/server-url";
import type { SearchResultItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface VideoPickerProps {
  canAdd: boolean;
  canPlayNow: boolean;
  playingVideoId?: string | null;
  playingVideoTitle?: string | null;
  playingVideoChannel?: string | null;
  onQueue: (payload: Record<string, string>) => void;
  onPlayNow: (payload: Record<string, string>) => void;
  embedded?: boolean;
}

export function VideoPicker({
  canAdd,
  canPlayNow,
  playingVideoId,
  playingVideoTitle,
  playingVideoChannel,
  onQueue,
  onPlayNow,
  embedded = false,
}: VideoPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [browseMode, setBrowseMode] = useState<"idle" | "search" | "related">("idle");
  const relatedForRef = useRef<string | null>(null);

  const inputMode = useMemo(() => classifyBrowseInput(query), [query]);
  const isUrlMode = inputMode === "youtube_url" || inputMode === "direct_url";
  const showRelated = browseMode !== "search" && !isUrlMode && Boolean(playingVideoId);

  const payloadFromQuery = useCallback(() => {
    const parsed = parseVideoUrl(query);
    if (!parsed) return null;
    const payload: Record<string, string> = { source: parsed.source, title: parsed.title };
    if (parsed.videoId) payload.videoId = parsed.videoId;
    if (parsed.url) payload.url = parsed.url;
    if (parsed.mimeType) payload.mimeType = parsed.mimeType;
    if (parsed.thumbnail) payload.thumbnail = parsed.thumbnail;
    return payload;
  }, [query]);

  const loadRelated = useCallback(async (videoId: string, title?: string | null, channel?: string | null) => {
    setLoading(true);
    if (browseMode !== "search") setError("");
    setBrowseMode("related");
    try {
      const params = new URLSearchParams({ videoId });
      if (title?.trim()) params.set("title", title.trim());
      if (channel?.trim()) params.set("channel", channel.trim());
      const res = await fetch(apiUrl(`/api/related?${params}`));
      const data = await res.json();
      const list = data.items ?? [];
      relatedForRef.current = videoId;
      if (list.length > 0) {
        setResults(list);
        setError("");
      } else {
        const fallbackQ = channel?.trim() || title?.split(/[|\-–—(]/)[0]?.trim();
        if (fallbackQ && fallbackQ.length >= 2) {
          try {
            const sRes = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(fallbackQ)}`));
            const sData = await sRes.json();
            const sList = (sData.items ?? []).filter(
              (v: { videoId: string }) => v.videoId !== videoId
            );
            if (sList.length > 0) {
              setResults(sList);
              setError("");
              return;
            }
          } catch {
            // silent
          }
        }
        setResults([]);
        setError("");
      }
    } catch {
      setError("");
    } finally {
      setLoading(false);
    }
  }, [browseMode]);

  const search = useCallback(async (q: string) => {
    relatedForRef.current = null;
    setLoading(true);
    setError("");
    setBrowseMode("search");
    try {
      const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(q)}`));
      const data = await res.json();
      const list = data.items ?? [];
      if (list.length === 0) {
        setError(data.error || "No results found.");
        setResults([]);
        return;
      }
      setResults(list);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isUrlMode) {
      setResults([]);
      setError("");
      setBrowseMode("idle");
      return;
    }
    if (!query.trim() && browseMode === "search") {
      setBrowseMode(playingVideoId ? "related" : "idle");
      setResults([]);
      setError("");
      relatedForRef.current = null;
      if (playingVideoId) void loadRelated(playingVideoId, playingVideoTitle, playingVideoChannel);
    }
  }, [query, isUrlMode, browseMode, playingVideoId, playingVideoTitle, playingVideoChannel, loadRelated]);

  useEffect(() => {
    if (browseMode === "search" || isUrlMode) return;
    if (!playingVideoId) {
      relatedForRef.current = null;
      setResults([]);
      setBrowseMode("idle");
      setError("");
      return;
    }
    if (relatedForRef.current === playingVideoId) return;
    void loadRelated(playingVideoId, playingVideoTitle, playingVideoChannel);
  }, [playingVideoId, playingVideoTitle, playingVideoChannel, browseMode, isUrlMode, loadRelated]);

  const runUrlAction = (mode: "queue" | "play") => {
    if (!canAdd) return;
    const payload = payloadFromQuery();
    if (!payload) {
      setError("Invalid video URL.");
      return;
    }
    if (mode === "play" && !canPlayNow) return;
    if (mode === "queue") onQueue(payload);
    else onPlayNow(payload);
    setQuery("");
    setResults([]);
    setError("");
    setBrowseMode("idle");
    relatedForRef.current = null;
  };

  const handleEnter = () => {
    if (!canAdd) return;
    if (isUrlMode) runUrlAction("queue");
    else if (query.trim().length >= 2) void search(query.trim());
  };

  const listTitle =
    browseMode === "search" ? "Search results" : showRelated ? "Similar songs" : null;

  const submitSearch = () => {
    if (isUrlMode) runUrlAction("queue");
    else if (query.trim().length >= 2) void search(query.trim());
  };

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col bg-surface",
        !embedded && "lg:min-w-[320px] lg:flex-1 lg:border-l lg:border-[var(--border)]"
      )}
    >
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">Discover</p>
            <p className="text-xs text-muted">Search YouTube or paste a link</p>
          </div>
          {browseMode === "related" && (
            <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary-soft">
              Auto
            </span>
          )}
        </div>

        <div
          className={`flex h-11 items-stretch overflow-hidden rounded-xl border transition ${
            !canAdd
              ? "border-[var(--border)] opacity-60"
              : "border-[var(--border-strong)] bg-surface-elevated focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20"
          }`}
        >
          <div className="relative flex min-w-0 flex-1 items-center">
            <Icon
              icon={isUrlMode ? "mdi:link-variant" : "mdi:magnify"}
              className="pointer-events-none absolute left-3 text-base text-muted"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Song, artist, or YouTube URL…"
              onKeyDown={(e) => e.key === "Enter" && handleEnter()}
              disabled={!canAdd}
              className="h-full w-full min-w-0 border-0 bg-transparent py-0 pl-10 pr-2 text-sm text-foreground placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
            />
            {query && canAdd && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setError("");
                  setBrowseMode(playingVideoId ? "related" : "idle");
                  relatedForRef.current = null;
                  if (playingVideoId) void loadRelated(playingVideoId, playingVideoTitle, playingVideoChannel);
                  else setResults([]);
                }}
                className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-white/[0.06] hover:text-foreground"
                aria-label="Clear search"
              >
                <Icon icon="mdi:close" className="text-sm" />
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={!canAdd || loading || !query.trim()}
            onClick={submitSearch}
            className={`flex h-full shrink-0 items-center justify-center gap-1.5 border-l border-[var(--border)] px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              isUrlMode
                ? "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500 hover:text-white"
                : "bg-primary/10 text-primary-soft hover:bg-primary hover:text-white"
            }`}
          >
            {loading ? (
              <Icon icon="mdi:loading" className="animate-spin text-lg" />
            ) : isUrlMode ? (
              <>
                <Icon icon="mdi:plus" className="text-base" />
                <span className="hidden sm:inline">Add</span>
              </>
            ) : (
              <Icon icon="mdi:magnify" className="text-lg" />
            )}
          </button>
        </div>

        {isUrlMode && canAdd && (
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <Button className="h-9" size="sm" variant="outline" onClick={() => runUrlAction("queue")}>
              <Icon icon="mdi:playlist-plus" />
              Add to queue
            </Button>
            {canPlayNow ? (
              <Button className="h-9" size="sm" onClick={() => runUrlAction("play")}>
                <Icon icon="mdi:play-circle" />
                Play now
              </Button>
            ) : (
              <Button className="h-9" size="sm" variant="outline" disabled>
                <Icon icon="mdi:play-circle" />
                Host plays
              </Button>
            )}
          </div>
        )}

        {!canAdd && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white/[0.02] px-3 py-2.5 text-[11px] text-muted">
            <Icon icon="mdi:lock-outline" className="shrink-0 text-primary-soft" />
            Join the room to search and add videos
          </p>
        )}

        {error && browseMode === "search" && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
            <Icon icon="mdi:alert-circle-outline" className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        {listTitle && (
          <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-[var(--border)] bg-surface/95 px-4 py-3 backdrop-blur">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{listTitle}</p>
            {browseMode === "related" && playingVideoTitle && (
              <p className="mt-0.5 line-clamp-1 text-xs text-foreground">
                Songs like &ldquo;{playingVideoTitle}&rdquo;
              </p>
            )}
          </div>
        )}

        {inputMode === "empty" && results.length === 0 && !loading && !showRelated && (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center text-muted">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.03] ring-1 ring-[var(--border)]">
              <Icon icon="mdi:youtube" className="text-3xl opacity-40" />
            </div>
            <p className="text-sm font-medium text-foreground/80">Search for songs, artists, or videos</p>
            <p className="mt-1.5 max-w-[14rem] text-xs leading-relaxed">Similar songs show up next to what is playing</p>
          </div>
        )}

        {loading && results.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
            <Icon icon="mdi:loading" className="animate-spin" />
            {browseMode === "related" ? "Loading related videos…" : "Searching…"}
          </div>
        )}

        <VideoCardGrid
          mode="search"
          items={results}
          canAdd={canAdd}
          canPlayNow={canPlayNow}
          onQueue={onQueue}
          onPlay={onPlayNow}
        />
      </div>
    </aside>
  );
}
