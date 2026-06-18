"use client";

import { useEffect, useState } from "react";
import { authenticateDiscord, type DiscordSession } from "@/lib/discord/auth";
import { setupDiscordNetworking } from "@/lib/discord/networking";

export function useDiscordActivity() {
  const [session, setSession] = useState<DiscordSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setupDiscordNetworking();

    authenticateDiscord()
      .then(setSession)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to start activity"))
      .finally(() => setLoading(false));
  }, []);

  return { session, error, loading };
}
