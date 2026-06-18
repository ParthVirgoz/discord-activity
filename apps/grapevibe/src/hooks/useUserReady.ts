"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/stores/userStore";

/** Wait for persisted userId before creating/joining rooms (avoids host mismatch). */
export function useUserReady() {
  const [ready, setReady] = useState(false);
  const userId = useUserStore((s) => s.userId);
  const username = useUserStore((s) => s.username);
  const ensureUserId = useUserStore((s) => s.ensureUserId);

  useEffect(() => {
    const finish = () => {
      ensureUserId();
      setReady(true);
    };

    if (useUserStore.persist.hasHydrated()) {
      finish();
      return;
    }

    return useUserStore.persist.onFinishHydration(finish);
  }, [ensureUserId]);

  return { ready, userId, username };
}
