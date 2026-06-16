export type UnoColor = "r" | "g" | "b" | "y" | "w";

export interface UnoCard {
  id: string;
  color: UnoColor;
  value: string;
}

export const COLOR_NAME: Record<UnoColor, string> = {
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
      return "Rev";
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
      return "W +4";
    case "wildDraw2":
      return "W +2";
    case "wildColor":
      return "W Color";
    default:
      return card.value;
  }
}

export function isWild(card: UnoCard): boolean {
  return card.color === "w" || card.value.startsWith("wild");
}

export function canPlayCard(
  card: UnoCard,
  top: UnoCard,
  currentColor: UnoColor,
  drawStack: number,
  mode: string
): boolean {
  if (drawStack > 0) {
    if (mode === "noMercy") {
      return ["draw1", "draw2", "draw5", "wild4", "wildDraw2"].includes(card.value);
    }
    return card.value === "draw2" || card.value === "wild4";
  }
  if (isWild(card)) return true;
  return card.color === currentColor || card.value === top.value;
}
