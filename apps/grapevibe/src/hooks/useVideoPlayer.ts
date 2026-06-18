"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DRIFT_THRESHOLD_SEC, SYNC_INTERVAL_MS } from "@/lib/types";
import { useRoomStore } from "@/stores/roomStore";
import { useUserStore } from "@/stores/userStore";

interface UseVideoPlayerOptions {
  enabled: boolean;
  canControlPlayback: boolean;
  emit: (event: string, data?: unknown) => void;
  onEnded: () => void;
}

export function useVideoPlayer({
  enabled,
  canControlPlayback,
  emit,
  onEnded,
}: UseVideoPlayerOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canControlRef = useRef(canControlPlayback);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playback = useRoomStore((s) => s.playback);
  const patchPlayback = useRoomStore((s) => s.patchPlayback);
  const setSyncing = useRoomStore((s) => s.setSyncing);
  const volume = useUserStore((s) => s.volume);
  const muted = useUserStore((s) => s.muted);

  useEffect(() => {
    canControlRef.current = canControlPlayback;
  }, [canControlPlayback]);

  const loadSource = useCallback((url: string, mimeType: string, startTime: number, autoplay: boolean) => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    el.innerHTML = "";
    const source = document.createElement("source");
    source.src = url;
    source.type = mimeType;
    el.appendChild(source);
    el.load();
    const onMeta = () => {
      el.removeEventListener("loadedmetadata", onMeta);
      setDuration(el.duration || 0);
      el.currentTime = startTime;
      setCurrentTime(startTime);
      setReady(true);
      if (autoplay) void el.play().catch(() => undefined);
    };
    el.addEventListener("loadedmetadata", onMeta);
  }, []);

  useEffect(() => {
    const video = enabled ? playback?.currentVideo : null;
    if (!video || video.source !== "direct" || !video.url) {
      const el = videoRef.current;
      if (el) {
        el.pause();
        el.removeAttribute("src");
        el.innerHTML = "";
        el.load();
      }
      setReady(false);
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }
    loadSource(video.url, video.mimeType ?? "video/mp4", playback?.currentTime ?? 0, playback?.playing ?? false);
    setPlaying(playback?.playing ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, playback?.currentVideo?.url, playback?.currentVideo?.id]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !ready) return;
    el.muted = muted;
    el.volume = muted ? 0 : volume / 100;
  }, [volume, muted, ready]);

  // Apply shared room playback to the local player (all users, including controllers).
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !ready || !playback) return;
    const drift = Math.abs(el.currentTime - playback.currentTime);
    if (drift > DRIFT_THRESHOLD_SEC) {
      setSyncing(true);
      el.currentTime = playback.currentTime;
      setCurrentTime(playback.currentTime);
      setTimeout(() => setSyncing(false), 400);
    }
    el.playbackRate = playback.speed ?? 1;
    if (playback.playing && el.paused) void el.play().catch(() => undefined);
    if (!playback.playing && !el.paused) el.pause();
    setPlaying(playback.playing);
  }, [playback?.currentTime, playback?.playing, playback?.speed, ready, setSyncing]);

  useEffect(() => {
    if (canControlPlayback || !enabled || !playback?.currentVideo) return;
    const id = setInterval(() => emit("sync"), SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [canControlPlayback, enabled, playback?.currentVideo, emit]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const tick = () => setCurrentTime(el.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => onEndedHandler();
    el.addEventListener("timeupdate", tick);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", tick);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
    function onEndedHandler() {
      if (canControlRef.current) onEnded();
    };
  }, [onEnded, ready]);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el || !canControlPlayback) return;
    const t = el.currentTime;
    if (el.paused) {
      patchPlayback({ currentTime: t, playing: true });
      emit("play", { currentTime: t });
    } else {
      patchPlayback({ currentTime: t, playing: false });
      emit("pause", { currentTime: t });
    }
  };

  const seek = (time: number) => {
    const el = videoRef.current;
    if (!el || !canControlPlayback) return;
    patchPlayback({ currentTime: time });
    emit("seek", { currentTime: time });
  };

  const setSpeed = (speed: number) => {
    const el = videoRef.current;
    if (!el || !canControlPlayback) return;
    patchPlayback({ speed });
    emit("speed_change", { speed });
  };

  return {
    videoRef,
    ready,
    currentTime,
    duration,
    playing,
    togglePlay,
    seek,
    setSpeed,
  };
}
