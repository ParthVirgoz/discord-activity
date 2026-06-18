"use client";

import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { MAX_VOLUME } from "@/lib/settings";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PlaybackSnapshot } from "@/lib/types";

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface PlayerSurfaceProps {
  isYouTube: boolean;
  isDirect: boolean;
  ytContainerRef: React.RefObject<HTMLDivElement | null>;
  htmlVideoRef: React.RefObject<HTMLVideoElement | null>;
  playback: PlaybackSnapshot | null;
  syncing: boolean;
  canAddToPlaylist: boolean;
  mode: "full" | "hidden";
  size?: "default" | "compact" | "large";
  fill?: boolean;
  fixedHeight?: boolean;
}

export function PlayerSurface({
  isYouTube,
  isDirect,
  ytContainerRef,
  htmlVideoRef,
  playback,
  syncing,
  canAddToPlaylist,
  mode,
  size = "default",
  fill = false,
  fixedHeight = false,
}: PlayerSurfaceProps) {
  const isCompact = size === "compact";
  const isLarge = size === "large";

  return (
    <div
      className={cn(
        "player-frame player-frame--room bg-black",
        mode === "full" && !fill && fixedHeight && "relative h-[14rem] w-full shrink-0",
        mode === "full" && !fill && !fixedHeight && "relative aspect-video w-full shrink-0",
        mode === "full" &&
          fill &&
          "absolute inset-0 h-full w-full shrink-0 rounded-none shadow-none",
        mode === "hidden" &&
          "pointer-events-none fixed -left-[9999px] top-0 z-[-1] h-px w-px overflow-hidden opacity-0"
      )}
      aria-hidden={mode === "hidden"}
    >
      <div
        ref={ytContainerRef}
        className={cn(
          "absolute inset-0 h-full w-full [&>iframe]:h-full [&>iframe]:w-full",
          isYouTube ? "z-10" : "pointer-events-none opacity-0"
        )}
      />
      <video
        ref={htmlVideoRef}
        className={cn(
          "absolute inset-0 h-full w-full object-contain",
          isDirect ? "z-10" : "pointer-events-none opacity-0"
        )}
        playsInline
        preload="metadata"
      />
      {mode === "full" && !playback?.currentVideo && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <div
            className={cn(
              "flex items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10",
              isCompact ? "h-10 w-10 lg:h-9 lg:w-9" : isLarge ? "h-16 w-16" : "h-14 w-14"
            )}
          >
            <Icon
              icon="mdi:play-circle-outline"
              className={cn(
                "text-muted",
                isCompact ? "text-2xl lg:text-xl" : isLarge ? "text-4xl" : "text-3xl"
              )}
            />
          </div>
          <p
            className={cn(
              "max-w-[16rem] leading-relaxed text-muted",
              isCompact
                ? "text-xs lg:max-w-[12rem] lg:text-[11px]"
                : isLarge
                  ? "text-sm"
                  : "text-sm"
            )}
          >
            {canAddToPlaylist
              ? isLarge
                ? "Pick a movie or video from Discover"
                : "Pick from Discover or playlist"
              : "Waiting to join…"}
          </p>
        </div>
      )}
      {mode === "full" && syncing && (
        <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-black/60 px-2.5 py-1 text-[11px] font-medium text-emerald-300 backdrop-blur-md">
          <Icon icon="mdi:sync" className="animate-spin text-sm" />
          Syncing
        </div>
      )}
    </div>
  );
}

interface PlaybackControlsProps {
  playback: PlaybackSnapshot | null;
  canControlPlayback: boolean;
  player: {
    currentTime: number;
    duration: number;
    playing: boolean;
    togglePlay: () => void;
    seek: (t: number) => void;
    setSpeed: (s: number) => void;
  };
  displaySpeed: number;
  volume: number;
  muted: boolean;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  onSkip: () => void;
  compact?: boolean;
  dense?: boolean;
}

export function PlaybackControls({
  playback,
  canControlPlayback,
  player,
  displaySpeed,
  volume,
  muted,
  setVolume,
  setMuted,
  onSkip,
  compact = false,
  dense = false,
}: PlaybackControlsProps) {
  return (
    <div
      className={cn(
        "z-10 shrink-0 border-b border-[var(--border)] bg-surface/95 backdrop-blur-sm lg:border-b-0",
        dense ? "px-2.5 py-2" : "px-4 py-3"
      )}
    >
      <p
        className={cn(
          "truncate font-medium text-foreground",
          dense ? "mb-1 text-xs" : "mb-2 text-sm"
        )}
      >
        {playback?.currentVideo?.title || "Nothing playing"}
      </p>
      <div
        className={cn(
          "progress-track",
          dense ? "mb-2" : "mb-3",
          canControlPlayback ? "cursor-pointer" : "opacity-60"
        )}
        onClick={(e) => {
          if (!canControlPlayback || !player.duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          player.seek(Math.max(0, Math.min(1, ratio)) * player.duration);
        }}
        role="presentation"
      >
        <div
          className="progress-fill"
          style={{
            width: `${player.duration ? (player.currentTime / player.duration) * 100 : 0}%`,
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canControlPlayback ? (
          <>
            <Button
              size="icon"
              variant="primary"
              className={cn("rounded-full", dense ? "h-8 w-8" : "h-9 w-9")}
              onClick={player.togglePlay}
              disabled={!playback?.currentVideo}
            >
              <Icon icon={player.playing ? "mdi:pause" : "mdi:play"} className={dense ? "text-base" : "text-lg"} />
            </Button>
            <Button size="icon" variant="ghost" className={dense ? "h-8 w-8" : "h-9 w-9"} onClick={onSkip}>
              <Icon icon="mdi:skip-next" />
            </Button>
            {!compact && (
              <div className="hidden rounded-xl bg-black/20 p-0.5 ring-1 ring-[var(--border)] sm:flex">
                {SPEED_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => player.setSpeed(s)}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition",
                      displaySpeed === s
                        ? "bg-primary/20 text-primary-soft"
                        : "text-muted hover:text-foreground"
                    )}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            )}
            {compact && (
              <span className="rounded-lg bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-muted ring-1 ring-[var(--border)]">
                {displaySpeed}x
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-muted">Host controls playback</span>
        )}
        <span className="text-xs tabular-nums text-muted">
          {formatTime(player.currentTime)} / {formatTime(player.duration)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMuted(!muted)}
            className="rounded-lg p-1.5 text-muted transition hover:bg-white/5 hover:text-foreground"
          >
            <Icon
              icon={muted ? "mdi:volume-off" : volume === 0 ? "mdi:volume-mute" : "mdi:volume-high"}
            />
          </button>
          <input
            type="range"
            min={0}
            max={MAX_VOLUME}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setVolume(v);
              if (v > 0 && muted) setMuted(false);
            }}
            className={cn("h-1 accent-primary", dense ? "w-16" : "w-20 sm:w-28")}
            title="Volume"
          />
        </div>
      </div>
    </div>
  );
}
