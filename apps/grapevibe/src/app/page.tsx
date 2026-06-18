"use client";

import { Icon } from "@iconify/react";
import { RoomView } from "@/components/RoomView";
import { useDiscordActivity } from "@/hooks/useDiscordActivity";
import { discordAvatarUrl } from "@/lib/discord/sdk";

export default function DiscordActivityPage() {
  const { session, error, loading } = useDiscordActivity();

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background text-muted">
        <Icon icon="mdi:loading" className="animate-spin text-3xl text-primary-soft" />
        <p className="text-sm">Starting Grapevibe…</p>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <Icon icon="mdi:alert-circle-outline" className="text-3xl text-red-400" />
        <p className="max-w-sm text-sm text-red-300">{error || "Could not start activity."}</p>
        <p className="max-w-sm text-xs text-muted">
          Join a voice channel in Discord, then open this Activity from the voice channel menu.
        </p>
      </div>
    );
  }

  return (
    <RoomView
      roomId={session.channelId}
      userId={session.user.id}
      username={session.user.username}
      avatarUrl={discordAvatarUrl(session.user.id, session.user.avatar)}
      authToken={session.token}
    />
  );
}
