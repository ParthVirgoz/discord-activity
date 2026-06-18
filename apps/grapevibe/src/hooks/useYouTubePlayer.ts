"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DRIFT_THRESHOLD_SEC, SYNC_INTERVAL_MS } from "@/lib/types";
import { useRoomStore } from "@/stores/roomStore";
import { useUserStore } from "@/stores/userStore";

declare global {
  interface Window {
    YT: {
      Player: new (
        elementId: string | HTMLElement,
        options: {
          videoId?: string;
          width?: string | number;
          height?: string | number;
          playerVars?: Record<string, number | string>;
          events?: {
            onReady?: (e: { target: YTPlayer }) => void;
            onStateChange?: (e: { data: number; target: YTPlayer }) => void;
          };
        }
      ) => YTPlayer;
      PlayerState: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setPlaybackRate: (rate: number) => void;
  destroy: () => void;
  mute: () => void;
  unMute: () => void;
  setVolume: (volume: number) => void;
  getPlaybackRate?: () => number;
}

function isYtPlayerUsable(p: unknown): p is YTPlayer {
  if (!p || typeof p !== "object") return false;
  const player = p as YTPlayer;
  return (
    typeof player.getCurrentTime === "function" &&
    typeof player.getDuration === "function" &&
    typeof player.getPlayerState === "function"
  );
}

function safePlayer(ref: React.RefObject<YTPlayer | null>): YTPlayer | null {
  const p = ref.current;
  return isYtPlayerUsable(p) ? p : null;
}

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    const done = () => resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      done();
    };
    if (window.YT?.Player) {
      done();
      return;
    }
    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const poll = setInterval(() => {
        if (window.YT?.Player) {
          clearInterval(poll);
          done();
        }
      }, 50);
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

interface UseYouTubePlayerOptions {
  enabled: boolean;
  canControlPlayback: boolean;
  emit: (event: string, data?: unknown) => void;
  onEnded: () => void;
}

export function useYouTubePlayer({
  enabled,
  canControlPlayback,
  emit,
  onEnded,
}: UseYouTubePlayerOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const canControlRef = useRef(canControlPlayback);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playback = useRoomStore((s) => s.playback);
  const setSyncing = useRoomStore((s) => s.setSyncing);
  const patchPlayback = useRoomStore((s) => s.patchPlayback);
  const volume = useUserStore((s) => s.volume);
  const muted = useUserStore((s) => s.muted);
  const videoId = enabled ? playback?.currentVideo?.videoId : undefined;

  useEffect(() => {
    canControlRef.current = canControlPlayback;
  }, [canControlPlayback]);

  const destroyPlayer = useCallback(() => {
    const p = playerRef.current;
    if (isYtPlayerUsable(p)) {
      try {
        p.destroy();
      } catch {
        // player may already be torn down
      }
    }
    playerRef.current = null;
    setReady(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  useEffect(() => {
    if (!enabled || !videoId || !containerRef.current) {
      destroyPlayer();
      return;
    }

    let cancelled = false;

    void loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current) return;
      destroyPlayer();
      containerRef.current.innerHTML = "";

      new window.YT.Player(containerRef.current, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 0,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: typeof window !== "undefined" ? window.location.origin : "",
        },
        events: {
          onReady: (e) => {
            if (cancelled) {
              try {
                e.target.destroy();
              } catch {
                // ignore
              }
              return;
            }
            playerRef.current = e.target;
            const start = playback?.currentTime ?? 0;
            const dur = e.target.getDuration() || 0;
            setDuration(dur);
            if (start > 0) e.target.seekTo(start, true);
            setCurrentTime(start);
            if (playback?.playing) e.target.playVideo();
            else e.target.pauseVideo();
            setPlaying(Boolean(playback?.playing));
            if (playback?.speed) e.target.setPlaybackRate(playback.speed);
            setReady(true);
          },
          onStateChange: (e) => {
            if (cancelled || !canControlRef.current) return;
            const state = e.data;
            if (state === window.YT.PlayerState.ENDED) onEnded();
            if (state === window.YT.PlayerState.PLAYING) setPlaying(true);
            if (state === window.YT.PlayerState.PAUSED) setPlaying(false);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      destroyPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, videoId]);

  useEffect(() => {
    const p = safePlayer(playerRef);
    if (!p || !ready) return;
    if (muted) p.mute();
    else {
      p.unMute();
      p.setVolume(volume);
    }
  }, [volume, muted, ready]);

  // Apply shared room playback to the local player (all users, including controllers).
  useEffect(() => {
    const p = safePlayer(playerRef);
    if (!p || !ready || !playback) return;
    const drift = Math.abs(p.getCurrentTime() - playback.currentTime);
    if (drift > DRIFT_THRESHOLD_SEC) {
      setSyncing(true);
      p.seekTo(playback.currentTime, true);
      setCurrentTime(playback.currentTime);
      setTimeout(() => setSyncing(false), 400);
    }
    const state = p.getPlayerState();
    if (playback.playing && state !== window.YT.PlayerState.PLAYING) p.playVideo();
    if (!playback.playing && state === window.YT.PlayerState.PLAYING) p.pauseVideo();
    p.setPlaybackRate(playback.speed ?? 1);
    setPlaying(playback.playing);
  }, [playback?.currentTime, playback?.playing, playback?.speed, ready, setSyncing]);

  // Passive viewers poll server for drift correction; controllers follow play/pause/seek events.
  useEffect(() => {
    if (canControlPlayback || !enabled || !playback?.currentVideo || !ready) return;
    const id = setInterval(() => emit("sync"), SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [canControlPlayback, enabled, playback?.currentVideo, ready, emit]);

  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const p = safePlayer(playerRef);
      if (!p) return;
      try {
        setCurrentTime(p.getCurrentTime());
        const dur = p.getDuration();
        if (dur > 0) setDuration(dur);
      } catch {
        // player destroyed mid-tick
      }
    }, 500);
    return () => clearInterval(id);
  }, [ready]);

  const togglePlay = () => {
    const p = safePlayer(playerRef);
    if (!p || !canControlPlayback || !ready) return;
    const t = p.getCurrentTime();
    const state = p.getPlayerState();
    if (state === window.YT.PlayerState.PLAYING) {
      patchPlayback({ currentTime: t, playing: false });
      emit("pause", { currentTime: t });
    } else {
      patchPlayback({ currentTime: t, playing: true });
      emit("play", { currentTime: t });
    }
  };

  const seek = (time: number) => {
    const p = safePlayer(playerRef);
    if (!p || !canControlPlayback || !ready) return;
    patchPlayback({ currentTime: time });
    emit("seek", { currentTime: time });
  };

  const setSpeed = (speed: number) => {
    if (!canControlPlayback || !ready || !safePlayer(playerRef)) return;
    patchPlayback({ speed });
    emit("speed_change", { speed });
  };

  return {
    containerRef,
    ready,
    currentTime,
    duration,
    playing,
    togglePlay,
    seek,
    setSpeed,
  };
}
