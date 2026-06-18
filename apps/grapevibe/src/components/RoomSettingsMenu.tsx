"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { SegmentedToggle, ToggleRow } from "@/components/ui/toggle";
import { useIsMobileOverlay } from "@/hooks/useIsMobileOverlay";
import { useRoomStore } from "@/stores/roomStore";
import { playlistModeDescription } from "@/lib/playlist";
import { watchModeDescription } from "@/lib/watch-mode";
import type { PlaylistMode, QueueAfterJump, RoomSettings, WatchMode } from "@/lib/types";
import { cn } from "@/lib/utils";

interface RoomSettingsMenuProps {
  emit: (event: string, data?: unknown) => void;
  compact?: boolean;
}

export function RoomSettingsMenu({ emit, compact = false }: RoomSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [panelStyle, setPanelStyle] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const anchorRef = useRef<HTMLDivElement>(null);
  const isHost = useRoomStore((s) => s.isHost);
  const settings = useRoomStore((s) => s.settings);
  const isMobile = useIsMobileOverlay();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || isMobile) return;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPanelStyle({
        top: rect.bottom + 8,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, isMobile]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile]);

  const toggle = (key: keyof RoomSettings, value: boolean) => {
    emit("settings_update", { [key]: value });
  };

  const setQueueAfterJump = (value: QueueAfterJump) => {
    emit("settings_update", { queueAfterJump: value });
  };

  const setPlaylistMode = (mode: PlaylistMode) => {
    emit("settings_update", { playlistMode: mode });
  };

  const setWatchMode = (mode: WatchMode) => {
    emit("settings_update", { watchMode: mode });
  };

  const settingsBody = isHost ? (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-white/[0.02] p-3.5">
        <p className="text-xs font-semibold text-foreground">Watch mode</p>
        <SegmentedToggle
          value={settings.watchMode}
          options={[
            { value: "music", label: "Music" },
            { value: "movie", label: "Movie" },
          ]}
          onChange={setWatchMode}
        />
        <p className="text-[10px] leading-snug text-muted">
          {watchModeDescription(settings.watchMode)}
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-white/[0.02] p-3.5">
        <p className="text-xs font-semibold text-foreground">Playlist</p>
        <div>
          <p className="mb-2 text-[10px] font-medium text-muted">Mode</p>
          <SegmentedToggle
            value={settings.playlistMode}
            options={[
              { value: "queue", label: "Queue" },
              { value: "list", label: "List" },
            ]}
            onChange={setPlaylistMode}
          />
          <p className="mt-2 text-[10px] leading-snug text-muted">
            {playlistModeDescription(settings.playlistMode)}
          </p>
        </div>
        <ToggleRow
          label="Shuffle"
          description="Play upcoming videos in random order."
          checked={settings.shuffle}
          onChange={(v) => toggle("shuffle", v)}
        />
      </div>

      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-white/[0.02] p-3.5">
        <p className="text-xs font-semibold text-foreground">Permissions</p>
        <ToggleRow
          label="Everyone can edit playlist"
          description="Reorder, remove, play next, and clear the queue."
          checked={settings.everyoneCanReorderPlaylist}
          onChange={(v) => toggle("everyoneCanReorderPlaylist", v)}
        />
        <ToggleRow
          label="Everyone can control playback"
          description="Anyone can play, pause, seek, skip, and change speed — synced for everyone in the room."
          checked={settings.everyoneCanControlPlayback}
          onChange={(v) => toggle("everyoneCanControlPlayback", v)}
        />
        <ToggleRow
          label="Anyone can become host"
          description="Let viewers take over host controls."
          checked={settings.anyoneCanBecomeHost}
          onChange={(v) => toggle("anyoneCanBecomeHost", v)}
        />
        <p className="text-[10px] text-muted">Anyone can always add songs to the queue.</p>
      </div>

      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-white/[0.02] p-3.5">
        <p className="text-xs font-semibold text-foreground">After clicking a queue video</p>
        <SegmentedToggle
          value={settings.queueAfterJump}
          options={[
            { value: "continue", label: "Continue" },
            { value: "fifo", label: "Resume order" },
          ]}
          onChange={setQueueAfterJump}
        />
        <p className="text-[10px] leading-snug text-muted">
          {settings.queueAfterJump === "continue"
            ? "After the clicked video, play the next item after it in the list."
            : "After the clicked video, play the next item at the front of the queue."}
        </p>
      </div>
    </div>
  ) : (
    <div className="space-y-3 text-xs text-muted">
      <p>
        Watch mode:{" "}
        <span className="capitalize text-foreground">{settings.watchMode}</span>
      </p>
      <p>
        Playlist mode:{" "}
        <span className="capitalize text-foreground">{settings.playlistMode}</span>
        {settings.shuffle && " · Shuffle on"}
      </p>
      <p>
        Playlist editing:{" "}
        <span className="text-foreground">
          {settings.everyoneCanReorderPlaylist ? "Everyone" : "Host only"}
        </span>
      </p>
      <p>
        Playback control:{" "}
        <span className="text-foreground">
          {settings.everyoneCanControlPlayback ? "Everyone" : "Host only"}
        </span>
      </p>
      <p>
        After queue jump:{" "}
        <span className="text-foreground">
          {settings.queueAfterJump === "continue" ? "Continue from position" : "Resume queue order"}
        </span>
      </p>
      {settings.anyoneCanBecomeHost && (
        <Button
          className="w-full"
          size="sm"
          onClick={() => {
            emit("claim_host");
            setOpen(false);
          }}
        >
          <Icon icon="mdi:crown" />
          Become host
        </Button>
      )}
    </div>
  );

  const panel = (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[300] cursor-default bg-black/50"
        aria-label="Close settings"
        onClick={() => setOpen(false)}
      />
      <div
        className={cn(
          "fixed z-[301] overflow-y-auto border border-[var(--border)] bg-surface-elevated shadow-2xl",
          isMobile
            ? "inset-x-0 bottom-0 max-h-[min(88vh,800px)] w-full rounded-t-2xl border-b-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            : "premium-card max-h-[min(80vh,640px)] w-80 rounded-xl p-4"
        )}
        style={isMobile ? undefined : { top: panelStyle.top, right: panelStyle.right }}
        role="dialog"
        aria-modal="true"
        aria-label="Room settings"
      >
        {isMobile && (
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" aria-hidden />
        )}
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Room settings</p>
          {isMobile && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-muted hover:bg-background hover:text-foreground"
              aria-label="Close"
            >
              <Icon icon="mdi:close" />
            </button>
          )}
        </div>
        {settingsBody}
      </div>
    </>
  );

  return (
    <div ref={anchorRef} className="relative shrink-0">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        className={cn(compact && "h-8 w-8 px-0")}
        aria-expanded={open}
        aria-label="Room settings"
      >
        <Icon icon="mdi:cog" />
        {!compact && <span>Settings</span>}
      </Button>
      {open && mounted && createPortal(panel, document.body)}
    </div>
  );
}
