"use client";

import { useEffect } from "react";
import { discordSDK } from "@/lib/discord/sdk";

/** Leave the Socket.IO room when the user leaves voice or the activity instance. */
export function useDiscordRoomLifecycle(
  channelId: string,
  userId: string,
  onLeave: () => void
) {
  useEffect(() => {
    if (!channelId || !userId) return;

    let active = true;

    const checkVoiceChannel = () => {
      if (!active) return;
      const current = discordSDK.channelId;
      if (current == null || current !== channelId) {
        onLeave();
      }
    };

    const onParticipantsUpdate = (data: { participants?: { id: string }[] }) => {
      const ids = data.participants?.map((p) => p.id) ?? [];
      if (!ids.includes(userId)) onLeave();
    };

    void discordSDK.ready().then(async () => {
      checkVoiceChannel();

      try {
        const { participants } = await discordSDK.commands.getInstanceConnectedParticipants();
        if (!participants.some((p) => p.id === userId)) onLeave();
      } catch {
        // Non-fatal in local mock dev.
      }

      void discordSDK.subscribe("ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE", onParticipantsUpdate);
    });

    const interval = window.setInterval(checkVoiceChannel, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
      void discordSDK.unsubscribe("ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE", onParticipantsUpdate);
    };
  }, [channelId, userId, onLeave]);
}
