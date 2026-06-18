"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

interface JoinNameModalProps {
  roomId: string;
  onJoin: (name: string) => void;
}

export function JoinNameModal({ roomId, onJoin }: JoinNameModalProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter your name to join the watch party.");
      return;
    }
    onJoin(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
      <Card className="w-full max-w-md p-8">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <h1 className="mb-2 text-center text-2xl font-bold tracking-tight">Join {APP_NAME}</h1>
        <p className="mb-8 text-center text-sm leading-relaxed text-muted">
          Room{" "}
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-primary-soft">
            /{roomId}
          </span>
          <br />
          <span className="mt-2 inline-block text-xs">{APP_TAGLINE}</span>
        </p>
        <label className="mb-1.5 block text-xs font-medium text-muted">Your display name</label>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          placeholder="How should others see you?"
          maxLength={32}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="mb-3"
        />
        {error && (
          <p className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
            <Icon icon="mdi:alert-circle-outline" className="shrink-0" />
            {error}
          </p>
        )}
        <Button className="w-full" size="lg" onClick={submit}>
          <Icon icon="mdi:account-check" />
          Join room
        </Button>
      </Card>
    </div>
  );
}
