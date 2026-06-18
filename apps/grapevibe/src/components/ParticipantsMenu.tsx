"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { useIsMobileOverlay } from "@/hooks/useIsMobileOverlay";
import type { RoomMember, RoomSettings } from "@/lib/types";
import { discordAvatarUrl } from "@/lib/discord/sdk";
import { cn } from "@/lib/utils";

interface ParticipantsMenuProps {
  members: RoomMember[];
  hostId: string | undefined;
  userId: string;
  isHost: boolean;
  joined: boolean;
  settings: RoomSettings;
  emit: (event: string, data?: unknown) => void;
}


function MemberAvatar({ member, isRoomHost }: { member: RoomMember; isRoomHost: boolean }) {
  const avatarSrc = member.avatarUrl ?? discordAvatarUrl(member.userId, null);

  return (
    <span className="relative inline-flex h-6 w-6 shrink-0 rounded-full ring-2 ring-surface" title={member.username}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatarSrc} alt="" className="h-full w-full rounded-full object-cover" />
      {isRoomHost && (
        <Icon
          icon="mdi:crown"
          className="absolute -right-1 -top-1 text-[10px] text-amber-400 drop-shadow"
        />
      )}
    </span>
  );
}

export function ParticipantsMenu({
  members,
  hostId,
  userId,
  isHost,
  joined,
  settings,
  emit,
}: ParticipantsMenuProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [panelStyle, setPanelStyle] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const anchorRef = useRef<HTMLButtonElement>(null);
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

  const preview = members.slice(0, 4);
  const overflow = Math.max(0, members.length - preview.length);

  const panel = (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[300] cursor-default bg-black/50"
        aria-label="Close participants"
        onClick={() => setOpen(false)}
      />
      <div
        className={cn(
          "fixed z-[301] overflow-hidden border border-[var(--border)] bg-surface-elevated shadow-2xl",
          isMobile
            ? "inset-x-0 bottom-0 max-h-[min(75vh,560px)] w-full rounded-t-2xl border-b-0 pb-[env(safe-area-inset-bottom)]"
            : "premium-card w-72 rounded-xl"
        )}
        style={isMobile ? undefined : { top: panelStyle.top, right: panelStyle.right }}
        role="dialog"
        aria-modal="true"
        aria-label="Participants"
      >
        {isMobile && (
          <div className="flex justify-center pt-3">
            <div className="h-1 w-10 rounded-full bg-white/20" aria-hidden />
          </div>
        )}
        <div className="border-b border-[var(--border)] px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Watching</p>
              <p className="text-xs text-muted">
                {members.length} {members.length === 1 ? "person" : "people"} in this room
              </p>
            </div>
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
        </div>
        <ul className="max-h-72 overflow-y-auto p-2">
          {members.map((m) => {
            const isRoomHost = m.userId === hostId;
            const isYou = m.userId === userId;
            const canTransfer = isHost && !isYou;
            return (
              <li
                key={m.userId}
                className="flex items-center gap-2 rounded-xl px-2 py-2 transition hover:bg-white/[0.04]"
              >
                <MemberAvatar member={m} isRoomHost={isRoomHost} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.username}
                    {isYou && <span className="text-muted"> (you)</span>}
                  </p>
                  {isRoomHost && (
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                      Host
                    </p>
                  )}
                </div>
                {canTransfer && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => {
                      emit("transfer_host", { targetUserId: m.userId });
                      setOpen(false);
                    }}
                  >
                    <Icon icon="mdi:crown-outline" />
                    Make host
                  </Button>
                )}
              </li>
            );
          })}
          {members.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-muted">No one here yet</li>
          )}
        </ul>
        {!isHost && settings.anyoneCanBecomeHost && (
          <div className="border-t border-[var(--border)] p-3">
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
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white/[0.03] py-1.5 text-xs transition hover:border-[var(--border-strong)] hover:bg-white/[0.05] sm:gap-2 sm:px-3",
          isMobile ? "px-2" : "px-3"
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <div className="flex items-center">
          {joined && preview.length > 0 ? (
            <div className="flex -space-x-2">
              {preview.map((m) => (
                <MemberAvatar key={m.userId} member={m} isRoomHost={m.userId === hostId} />
              ))}
              {overflow > 0 && (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-elevated text-[9px] font-bold text-foreground ring-2 ring-surface">
                  +{overflow}
                </span>
              )}
            </div>
          ) : (
            <Icon icon="mdi:account-group" className="text-secondary" />
          )}
        </div>
        <span className="hidden font-medium sm:inline">{joined ? members.length : "…"} watching</span>
        <span className="font-medium sm:hidden">{joined ? members.length : "…"}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide",
            isHost ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary-soft"
          )}
        >
          {!joined ? "…" : isHost ? "HOST" : "VIEWER"}
        </span>
        <Icon icon={open ? "mdi:chevron-up" : "mdi:chevron-down"} className="hidden text-muted sm:block" />
      </button>
      {mounted && open && createPortal(panel, document.body)}
    </>
  );
}
