import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-xl border border-[var(--border)] bg-surface-elevated/80 px-4 py-2 text-sm text-foreground shadow-inner shadow-black/20 placeholder:text-muted/80 transition-colors focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20",
        className
      )}
      {...props}
    />
  );
}
