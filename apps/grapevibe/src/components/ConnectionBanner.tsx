"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { isLikelyMisconfiguredVercelDeploy } from "@/lib/server-url";
import type { ConnectionStatus } from "@/stores/roomStore";
import { cn } from "@/lib/utils";

interface ConnectionBannerProps {
  status: ConnectionStatus;
  roomId: string;
  onReconnect: () => void;
}

export function ConnectionBanner({ status, roomId, onReconnect }: ConnectionBannerProps) {
  const [copiedId, setCopiedId] = useState(false);

  if (status === "connected") return null;

  const copyId = async () => {
    await navigator.clipboard.writeText(roomId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const isOffline = status === "offline";
  const isReconnecting = status === "reconnecting";

  return (
    <div
      className={cn(
        "relative z-50 flex shrink-0 flex-wrap items-center justify-center gap-3 border-b px-4 py-3 text-sm backdrop-blur-sm",
        isOffline
          ? "border-red-500/30 bg-red-500/10 text-red-100"
          : "border-amber-500/30 bg-amber-500/10 text-amber-50"
      )}
      role="status"
      aria-live="polite"
    >
      {isOffline ? (
        <Icon icon="mdi:wifi-off" className="text-lg text-red-300" />
      ) : (
        <Icon icon="mdi:loading" className="animate-spin text-lg text-amber-300" />
      )}

      <div className="min-w-0 text-center sm:text-left">
        <p className="font-semibold">
          {isOffline
            ? "Connection lost"
            : isReconnecting
              ? "Reconnecting to room…"
              : "Joining room…"}
        </p>
        <p className="text-xs opacity-90">
          {isOffline
            ? `You're still in /${roomId}. Tap reconnect or copy the room ID to rejoin.`
            : isReconnecting
              ? "Trying to restore your session automatically."
              : isLikelyMisconfiguredVercelDeploy()
                ? "This Vercel URL needs BACKEND_URL set to your Render app. See docs/DEPLOY.md."
                : "Connecting to the watch party."}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {(isOffline || isReconnecting) && (
          <Button variant="outline" size="sm" onClick={onReconnect}>
            <Icon icon="mdi:refresh" />
            Reconnect
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={copyId}>
          <Icon icon={copiedId ? "mdi:check" : "mdi:content-copy"} />
          {copiedId ? "Copied!" : "Copy ID"}
        </Button>
        {isOffline && (
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            <Icon icon="mdi:reload" />
            Reload page
          </Button>
        )}
      </div>
    </div>
  );
}
