import { Icon } from "@iconify/react";
import { cn } from "@/lib/utils";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 via-purple-600 to-emerald-500 shadow-lg shadow-purple-500/30 ring-1 ring-white/20">
        <Icon icon="mdi:fruit-grapes" className="text-[1.35rem] text-white drop-shadow" aria-hidden />
      </div>
      {showText && (
        <div className="leading-tight">
          <span className="text-lg font-bold tracking-tight text-foreground">{APP_NAME}</span>
          <span className="mt-0.5 block max-w-[12rem] text-[11px] font-medium leading-snug text-muted">
            {APP_TAGLINE}
          </span>
        </div>
      )}
    </div>
  );
}
