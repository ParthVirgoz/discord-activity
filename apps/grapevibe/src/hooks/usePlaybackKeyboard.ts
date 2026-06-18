"use client";

import { useEffect } from "react";
import { MAX_VOLUME } from "@/lib/settings";

const VOLUME_STEP = 5;
const SEEK_STEP = 5;
const SEEK_STEP_SHIFT = 10;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

interface UsePlaybackKeyboardOptions {
  enabled: boolean;
  canControlPlayback: boolean;
  hasVideo: boolean;
  currentTime: number;
  duration: number;
  togglePlay: () => void;
  seek: (time: number) => void;
  volume: number;
  muted: boolean;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
}

export function usePlaybackKeyboard({
  enabled,
  canControlPlayback,
  hasVideo,
  currentTime,
  duration,
  togglePlay,
  seek,
  volume,
  muted,
  setVolume,
  setMuted,
}: UsePlaybackKeyboardOptions) {
  useEffect(() => {
    if (!enabled || !hasVideo) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (e.code === "Space") {
        if (!canControlPlayback) return;
        e.preventDefault();
        togglePlay();
        return;
      }

      if (e.code === "ArrowUp") {
        e.preventDefault();
        if (muted) setMuted(false);
        setVolume(Math.min(MAX_VOLUME, (muted ? 0 : volume) + VOLUME_STEP));
        return;
      }

      if (e.code === "ArrowDown") {
        e.preventDefault();
        const next = Math.max(0, (muted ? 0 : volume) - VOLUME_STEP);
        if (next === 0) setMuted(true);
        else {
          if (muted) setMuted(false);
          setVolume(next);
        }
        return;
      }

      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        if (!canControlPlayback || duration <= 0) return;
        e.preventDefault();
        const delta = e.shiftKey ? SEEK_STEP_SHIFT : SEEK_STEP;
        const dir = e.code === "ArrowLeft" ? -1 : 1;
        const next = Math.max(0, Math.min(duration, currentTime + dir * delta));
        seek(next);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    enabled,
    hasVideo,
    canControlPlayback,
    currentTime,
    duration,
    togglePlay,
    seek,
    volume,
    muted,
    setVolume,
    setMuted,
  ]);
}
