"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { RoomSettingsMenu } from "@/components/RoomSettingsMenu";
import { ParticipantsMenu } from "@/components/ParticipantsMenu";
import type { ConnectionStatus } from "@/stores/roomStore";
import type { RoomMember, RoomSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

interface RoomHeaderProps {
  userId: string;
  isHost: boolean;
  joined: boolean;
  members: RoomMember[];
  hostId?: string;
  settings: RoomSettings;
  connectionStatus: ConnectionStatus;
  emit: (event: string, data?: unknown) => void;
}

export function RoomHeader({
  userId,
  isHost,
  joined,
  members,
  hostId,
  settings,
  connectionStatus,
  emit,
}: RoomHeaderProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const statusTitle =
    connectionStatus === "connected"
      ? "Connected"
      : connectionStatus === "offline"
        ? "Disconnected"
        : connectionStatus === "reconnecting"
          ? "Reconnecting…"
          : "Connecting…";

  const statusColor =
    connectionStatus === "connected"
      ? "bg-accent shadow-[0_0_8px_rgba(52,211,153,0.5)]"
      : connectionStatus === "offline"
        ? "bg-red-500"
        : "bg-amber-400 animate-pulse";

  return (
    <header className="glass-strong relative z-50 shrink-0 border-b border-[var(--border)] px-3 py-2 sm:px-4 sm:py-2.5">
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="shrink-0">
          <Logo showText={false} className="lg:hidden" />
          <Logo className="hidden lg:flex" />
        </div>

        <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted sm:text-sm">
          Voice channel watch party
        </p>

        <div className="hidden items-center gap-2 lg:flex">
          <ParticipantsMenu
            members={members}
            hostId={hostId}
            userId={userId}
            isHost={isHost}
            joined={joined}
            settings={settings}
            emit={emit}
          />
          <RoomSettingsMenu emit={emit} />
          <span className={cn("h-2 w-2 shrink-0 rounded-full", statusColor)} title={statusTitle} />
        </div>

        <div className="flex items-center gap-1 lg:hidden">
          <ParticipantsMenu
            members={members}
            hostId={hostId}
            userId={userId}
            isHost={isHost}
            joined={joined}
            settings={settings}
            emit={emit}
          />
          <RoomSettingsMenu emit={emit} compact />
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 px-0"
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              aria-label="Connection status"
            >
              <Icon icon="mdi:dots-vertical" />
            </Button>
            {mounted && moreOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-[59]"
                  aria-label="Close menu"
                  onClick={() => setMoreOpen(false)}
                />
                <div className="premium-card absolute right-0 top-full z-[60] mt-1.5 w-44 overflow-hidden rounded-xl py-1">
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
                    <span className={cn("h-2 w-2 rounded-full", statusColor)} />
                    {statusTitle}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
