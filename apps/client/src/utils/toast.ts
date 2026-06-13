import { icon, type AppIcon } from "./icons.js";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  type?: ToastType;
  duration?: number;
}

const TOAST_ICONS: Record<ToastType, AppIcon> = {
  success: "success",
  error: "alert",
  info: "info",
  warning: "warning",
};

const DEFAULT_DURATION = 4500;

class ToastManager {
  private stack: HTMLElement | null = null;

  private ensureStack(): HTMLElement {
    if (!this.stack) {
      this.stack = document.createElement("div");
      this.stack.className = "toast-stack";
      this.stack.setAttribute("aria-live", "polite");
      this.stack.setAttribute("aria-relevant", "additions");
      document.body.appendChild(this.stack);
    }
    return this.stack;
  }

  show(message: string, options: ToastType | ToastOptions = "info") {
    const opts: ToastOptions = typeof options === "string" ? { type: options } : options;
    const type = opts.type ?? "info";
    const duration = opts.duration ?? DEFAULT_DURATION;

    const stack = this.ensureStack();
    const item = document.createElement("div");
    item.className = `toast-item toast-item--${type}`;
    item.setAttribute("role", "status");

    const iconWrap = document.createElement("span");
    iconWrap.className = "toast-item__icon";
    iconWrap.appendChild(icon(TOAST_ICONS[type], 18, "toast-icon"));

    const body = document.createElement("div");
    body.className = "toast-item__body";

    const text = document.createElement("p");
    text.className = "toast-item__message";
    text.textContent = message;
    body.appendChild(text);

    const progress = document.createElement("span");
    progress.className = "toast-item__progress";
    progress.style.animationDuration = `${duration}ms`;
    body.appendChild(progress);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "toast-item__close";
    closeBtn.setAttribute("aria-label", "Dismiss");
    closeBtn.appendChild(icon("close", 14, "toast-icon"));

    item.appendChild(iconWrap);
    item.appendChild(body);
    item.appendChild(closeBtn);
    stack.appendChild(item);

    requestAnimationFrame(() => item.classList.add("toast-item--visible"));

    let timer = window.setTimeout(() => this.dismiss(item), duration);

    const dismissNow = () => {
      window.clearTimeout(timer);
      this.dismiss(item);
    };

    closeBtn.addEventListener("click", dismissNow);
    item.addEventListener("mouseenter", () => window.clearTimeout(timer));
    item.addEventListener("mouseleave", () => {
      timer = window.setTimeout(() => this.dismiss(item), 1200);
    });
  }

  private dismiss(item: HTMLElement) {
    if (item.classList.contains("toast-item--leaving")) return;
    item.classList.remove("toast-item--visible");
    item.classList.add("toast-item--leaving");
    item.addEventListener(
      "animationend",
      () => {
        item.remove();
        if (this.stack && this.stack.childElementCount === 0) {
          this.stack.remove();
          this.stack = null;
        }
      },
      { once: true }
    );
  }
}

export const toast = new ToastManager();
