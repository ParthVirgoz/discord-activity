import {
  createElement,
  Search,
  ChevronDown,
  Lock,
  Trash2,
  Play,
  Plus,
  Check,
  GripVertical,
  MoreVertical,
  CircleAlert,
  CircleCheck,
  Info,
  X,
  SkipForward,
  SkipBack,
  Pause,
  ArrowRight,
  TriangleAlert,
  List,
  Users,
  type IconNode,
} from "lucide";

export type AppIcon =
  | "search"
  | "chevron-down"
  | "lock"
  | "trash"
  | "play"
  | "plus"
  | "check"
  | "grip"
  | "more-vertical"
  | "alert"
  | "success"
  | "info"
  | "warning"
  | "close"
  | "skip"
  | "skip-back"
  | "pause"
  | "arrow-right"
  | "list"
  | "users";

const ICONS: Record<AppIcon, IconNode> = {
  search: Search,
  "chevron-down": ChevronDown,
  lock: Lock,
  trash: Trash2,
  play: Play,
  plus: Plus,
  check: Check,
  grip: GripVertical,
  "more-vertical": MoreVertical,
  alert: CircleAlert,
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  close: X,
  skip: SkipForward,
  "skip-back": SkipBack,
  pause: Pause,
  "arrow-right": ArrowRight,
  list: List,
  users: Users,
};

export function icon(name: AppIcon, size = 16, className = "ui-icon"): SVGElement {
  const node = ICONS[name];
  return createElement(node, {
    width: String(size),
    height: String(size),
    class: className,
    "aria-hidden": "true",
  });
}

export function iconHtml(name: AppIcon, size = 16, className = "ui-icon"): string {
  return icon(name, size, className).outerHTML;
}
