export type UnoColor = "r" | "g" | "b" | "y" | "w";

export type UnoGameMode = "classic" | "noMercy";

export interface UnoCard {
  id: string;
  color: UnoColor;
  value: string;
}

export const COLOR_LABEL: Record<UnoColor, string> = {
  r: "Red",
  g: "Green",
  b: "Blue",
  y: "Yellow",
  w: "Wild",
};

export function cardLabel(card: UnoCard): string {
  switch (card.value) {
    case "skip":
      return "Skip";
    case "reverse":
      return "Reverse";
    case "draw2":
      return "+2";
    case "draw1":
      return "+1";
    case "draw5":
      return "+5";
    case "skipAll":
      return "Skip All";
    case "wild":
      return "Wild";
    case "wild4":
      return "Wild +4";
    case "wildDraw2":
      return "Wild +2";
    case "wildColor":
      return "Wild Color";
    default:
      return card.value;
  }
}

function addColorRun(cards: UnoCard[], color: UnoColor, startId: { n: number }) {
  const push = (value: string, count = 1) => {
    for (let i = 0; i < count; i++) {
      cards.push({ id: `c${startId.n++}`, color, value });
    }
  };
  push("0", 1);
  for (let n = 1; n <= 9; n++) push(String(n), 2);
  push("skip", 2);
  push("reverse", 2);
  push("draw2", 2);
}

function addNoMercyColorRun(cards: UnoCard[], color: UnoColor, startId: { n: number }) {
  const push = (value: string, count = 1) => {
    for (let i = 0; i < count; i++) {
      cards.push({ id: `c${startId.n++}`, color, value });
    }
  };
  push("0", 1);
  for (let n = 1; n <= 9; n++) push(String(n), 2);
  push("skip", 2);
  push("reverse", 2);
  push("draw1", 2);
  push("draw5", 2);
}

export function buildDeck(mode: UnoGameMode): UnoCard[] {
  const id = { n: 0 };
  const cards: UnoCard[] = [];
  const colors: UnoColor[] = ["r", "g", "b", "y"];

  if (mode === "classic") {
    for (const color of colors) addColorRun(cards, color, id);
    for (let i = 0; i < 4; i++) {
      cards.push({ id: `c${id.n++}`, color: "w", value: "wild" });
      cards.push({ id: `c${id.n++}`, color: "w", value: "wild4" });
    }
  } else {
    for (const color of colors) addNoMercyColorRun(cards, color, id);
    for (const color of colors) {
      cards.push({ id: `c${id.n++}`, color, value: "skipAll" });
    }
    for (let i = 0; i < 4; i++) {
      cards.push({ id: `c${id.n++}`, color: "w", value: "wild" });
      cards.push({ id: `c${id.n++}`, color: "w", value: "wildDraw2" });
      cards.push({ id: `c${id.n++}`, color: "w", value: "wildColor" });
    }
  }

  return shuffle(cards);
}

export function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function isWildCard(card: UnoCard): boolean {
  return card.color === "w" || card.value.startsWith("wild");
}

export function drawValue(card: UnoCard): number {
  switch (card.value) {
    case "draw1":
      return 1;
    case "draw2":
      return 2;
    case "draw5":
      return 5;
    case "wild4":
      return 4;
    case "wildDraw2":
      return 2;
    default:
      return 0;
  }
}

export function isStackableDraw(card: UnoCard, mode: UnoGameMode): boolean {
  if (mode === "classic") {
    return card.value === "draw2" || card.value === "wild4";
  }
  return ["draw1", "draw2", "draw5", "wild4", "wildDraw2"].includes(card.value);
}

export function matchesColor(card: UnoCard, color: UnoColor): boolean {
  return card.color === color || isWildCard(card);
}

export function canPlayClassic(
  card: UnoCard,
  top: UnoCard,
  currentColor: UnoColor,
  drawStack: number
): boolean {
  if (drawStack > 0) {
    return card.value === "draw2" || card.value === "wild4";
  }
  if (isWildCard(card)) return true;
  return card.color === currentColor || card.value === top.value;
}

export function canPlayNoMercy(
  card: UnoCard,
  top: UnoCard,
  currentColor: UnoColor,
  drawStack: number
): boolean {
  if (drawStack > 0) {
    return isStackableDraw(card, "noMercy");
  }
  if (isWildCard(card)) return true;
  return card.color === currentColor || card.value === top.value;
}

export const MIN_UNO_PLAYERS = 2;
export const MAX_UNO_PLAYERS = 10;
export const INITIAL_HAND = 7;
