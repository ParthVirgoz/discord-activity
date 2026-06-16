import { JWT } from "@colyseus/auth";
import { Room, Client, CloseCode } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { isValidChannelId, sanitizeUsername } from "../utils/validation";
import {
  type UnoCard,
  type UnoColor,
  type UnoGameMode,
  buildDeck,
  canPlayClassic,
  canPlayNoMercy,
  drawValue,
  isWildCard,
  isStackableDraw,
  MIN_UNO_PLAYERS,
  MAX_UNO_PLAYERS,
  INITIAL_HAND,
  cardLabel,
  shuffle,
} from "./uno/unoCards";

export type UnoPhase = "lobby" | "playing" | "finished";

export class Member extends Schema {
  @type("string") username = "";
  @type("string") avatarUrl = "";
  @type("string") discordId = "";
}

export class TopCard extends Schema {
  @type("string") id = "";
  @type("string") color = "";
  @type("string") value = "";
}

export class UnoRoomState extends Schema {
  @type({ map: Member }) members = new MapSchema<Member>();
  @type({ map: "number" }) handCounts = new MapSchema<number>();
  @type("string") phase: UnoPhase = "lobby";
  @type("string") gameMode = "";
  @type("string") hostSessionId = "";
  @type("string") currentPlayerId = "";
  @type("number") direction = 1;
  @type("string") currentColor = "";
  @type(TopCard) topCard = new TopCard();
  @type("number") drawStack = 0;
  @type("string") statusMessage = "";
  @type("string") winnerSessionId = "";
  @type("string") unoWatchSessionId = "";
  @type("number") deckRemaining = 0;
  @type("string") channelId = "";
}

export class UnoRoom extends Room {
  state = new UnoRoomState();
  maxClients = MAX_UNO_PLAYERS;

  private channelId = "";
  private joinedAt = new Map<string, number>();
  private turnOrder: string[] = [];
  private hands = new Map<string, UnoCard[]>();
  private deck: UnoCard[] = [];
  private discard: UnoCard[] = [];
  private mode: UnoGameMode = "classic";
  /** No Mercy: force next player to draw until this color */
  private wildColorLock: UnoColor | null = null;

  static onAuth(token: string) {
    return JWT.verify(token);
  }

  onCreate(options: { channelId?: string }) {
    if (!isValidChannelId(options?.channelId)) throw new Error("Invalid channelId");
    this.channelId = options.channelId!;
    this.state.channelId = this.channelId;
    this.autoDispose = false;

    this.onMessage("startGame", (client, msg: { mode?: string }) => {
      this.handleStartGame(client, msg?.mode);
    });
    this.onMessage("playCard", (client, msg: { cardId?: string; wildColor?: string }) => {
      this.handlePlayCard(client, msg?.cardId, msg?.wildColor);
    });
    this.onMessage("drawCard", (client) => this.handleDraw(client));
    this.onMessage("callUno", (client) => this.handleCallUno(client));
    this.onMessage("catchUno", (client, msg: { targetSessionId?: string }) => {
      this.handleCatchUno(client, msg?.targetSessionId);
    });
    this.onMessage("playAgain", (client) => this.handlePlayAgain(client));
  }

  onJoin(client: Client, options: { channelId?: string }) {
    if (!isValidChannelId(options?.channelId) || options.channelId !== this.channelId) {
      throw new Error("Invalid channelId");
    }

    const auth = client.auth as { id?: string; username?: string; avatar?: string } | undefined;
    const discordId = typeof auth?.id === "string" ? auth.id : client.sessionId;
    const username = sanitizeUsername(auth?.username);
    const avatarHash = typeof auth?.avatar === "string" ? auth.avatar : "";

    for (const [sessionId, member] of this.state.members.entries()) {
      if (member.discordId === discordId && sessionId !== client.sessionId) {
        this.removePlayer(sessionId);
      }
    }

    const member = new Member();
    member.username = username;
    member.discordId = discordId;
    member.avatarUrl = avatarHash
      ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`
      : "";

    this.state.members.set(client.sessionId, member);
    this.joinedAt.set(client.sessionId, Date.now());
    this.hands.set(client.sessionId, []);
    this.state.handCounts.set(client.sessionId, 0);

    if (!this.state.hostSessionId || !this.state.members.has(this.state.hostSessionId)) {
      this.state.hostSessionId = client.sessionId;
    }

    this.sendHand(client);
    client.send("roomJoined", {
      sessionId: client.sessionId,
      isHost: this.state.hostSessionId === client.sessionId,
    });
  }

  async onLeave(client: Client, code: number) {
    if (code !== CloseCode.CONSENTED) {
      try {
        await this.allowReconnection(client, 120);
        this.sendHand(client);
        client.send("reconnected", { sessionId: client.sessionId });
        return;
      } catch {
        /* gone */
      }
    }

    this.removePlayer(client.sessionId);
    if (this.state.members.size === 0) {
      this.disconnect();
      return;
    }

    if (this.state.hostSessionId === client.sessionId) {
      this.state.hostSessionId = this.orderedSessions()[0] ?? "";
    }

    if (this.state.phase === "playing") {
      this.turnOrder = this.turnOrder.filter((id) => this.state.members.has(id));
      if (this.state.currentPlayerId === client.sessionId) {
        this.advanceTurn();
      }
      if (this.turnOrder.length < MIN_UNO_PLAYERS) {
        this.endToLobby("Not enough players — returning to lobby.");
      }
    }
  }

  private removePlayer(sessionId: string) {
    this.state.members.delete(sessionId);
    this.state.handCounts.delete(sessionId);
    this.hands.delete(sessionId);
    this.joinedAt.delete(sessionId);
    this.turnOrder = this.turnOrder.filter((id) => id !== sessionId);
  }

  private orderedSessions(): string[] {
    return [...this.joinedAt.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id)
      .filter((id) => this.state.members.has(id));
  }

  private isHost(client: Client): boolean {
    return client.sessionId === this.state.hostSessionId;
  }

  private handleStartGame(client: Client, modeRaw?: string) {
    if (!this.isHost(client)) return;
    if (this.state.phase !== "lobby" && this.state.phase !== "finished") return;
    const count = this.state.members.size;
    if (count < MIN_UNO_PLAYERS || count > MAX_UNO_PLAYERS) return;

    this.mode = modeRaw === "noMercy" ? "noMercy" : "classic";
    this.state.gameMode = this.mode;
    this.state.phase = "playing";
    this.state.winnerSessionId = "";
    this.state.unoWatchSessionId = "";
    this.state.direction = 1;
    this.state.drawStack = 0;
    this.wildColorLock = null;
    this.turnOrder = this.orderedSessions();
    this.deck = buildDeck(this.mode);
    this.discard = [];
    this.hands.clear();

    for (const sessionId of this.turnOrder) {
      this.hands.set(sessionId, []);
    }

    for (let i = 0; i < INITIAL_HAND; i++) {
      for (const sessionId of this.turnOrder) {
        this.drawToHand(sessionId, 1);
      }
    }

    let top = this.drawFromDeck();
    while (top && isWildCard(top)) {
      this.discard.push(top);
      top = this.drawFromDeck();
    }
    if (!top) {
      this.endToLobby("Could not start — empty deck.");
      return;
    }

    this.discard.push(top);
    this.syncTopCard(top);
    this.state.currentColor = top.color;
    this.state.deckRemaining = this.deck.length;

    if (top.value === "reverse" && this.turnOrder.length === 2) {
      this.state.direction *= -1;
    }

    this.state.currentPlayerId = this.turnOrder[0];
    this.syncHandCounts();
    this.broadcastHands();
    this.setStatus(`${this.playerName(this.state.currentPlayerId)}'s turn`);

    if (top.value === "skip") {
      this.advanceTurn();
    } else if (top.value === "skipAll" && this.mode === "noMercy") {
      this.advanceTurn();
    }

    this.broadcast("gameStarted", { mode: this.mode });
  }

  private handlePlayAgain(client: Client) {
    if (!this.isHost(client)) return;
    this.state.phase = "lobby";
    this.state.gameMode = "";
    this.state.statusMessage = "Pick a game mode to start.";
    this.state.winnerSessionId = "";
    this.broadcast("backToLobby", {});
  }

  private handlePlayCard(client: Client, cardId?: string, wildColorRaw?: string) {
    if (this.state.phase !== "playing") return;
    if (client.sessionId !== this.state.currentPlayerId) return;
    if (typeof cardId !== "string") return;

    const hand = this.hands.get(client.sessionId);
    if (!hand) return;
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return;

    const card = hand[idx];
    const top = this.currentTop();
    if (!top) return;

    const playable =
      this.mode === "classic"
        ? canPlayClassic(card, top, this.state.currentColor as UnoColor, this.state.drawStack)
        : canPlayNoMercy(card, top, this.state.currentColor as UnoColor, this.state.drawStack);

    if (!playable) return;

    if (card.value === "wild4" && this.mode === "classic") {
      const hasColor = hand.some(
        (c) => c.id !== cardId && c.color === this.state.currentColor && !isWildCard(c)
      );
      if (hasColor) return;
    }

    let chosenColor: UnoColor | null = null;
    if (isWildCard(card)) {
      if (typeof wildColorRaw !== "string" || !["r", "g", "b", "y"].includes(wildColorRaw)) {
        return;
      }
      chosenColor = wildColorRaw as UnoColor;
    }

    hand.splice(idx, 1);
    this.discard.push(card);

    if (this.state.drawStack > 0 && isStackableDraw(card, this.mode)) {
      this.state.drawStack += drawValue(card);
    } else if (isStackableDraw(card, this.mode)) {
      this.state.drawStack = drawValue(card);
    } else {
      this.state.drawStack = 0;
    }

    this.syncTopCard(card);
    if (chosenColor) {
      this.state.currentColor = chosenColor;
    } else if (!isWildCard(card)) {
      this.state.currentColor = card.color;
    }

    this.wildColorLock = null;
    this.syncHandCounts();
    this.sendHand(client);

    if (hand.length === 0) {
      this.declareWinner(client.sessionId);
      return;
    }

    if (hand.length === 1) {
      this.state.unoWatchSessionId = client.sessionId;
    }

    this.applyCardEffect(card, chosenColor);
    this.state.deckRemaining = this.deck.length;
    this.broadcastHands();

    if (this.state.phase !== "playing") return;
    if (this.state.drawStack > 0) {
      this.advanceTurn();
    } else if (!this.isActionCard(card)) {
      this.advanceTurn();
    }
  }

  private handleDraw(client: Client) {
    if (this.state.phase !== "playing") return;
    if (client.sessionId !== this.state.currentPlayerId) return;

    if (this.state.drawStack > 0) {
      this.drawToHand(client.sessionId, this.state.drawStack);
      this.state.drawStack = 0;
      this.syncHandCounts();
      this.sendHand(client);
      this.setStatus(`${this.playerName(client.sessionId)} drew the stack`);
      this.advanceTurn();
      return;
    }

    if (this.mode === "noMercy") {
      let drew = 0;
      let playable = false;
      const top = this.currentTop();
      while (!playable && drew < 20) {
        this.drawToHand(client.sessionId, 1);
        drew++;
        const hand = this.hands.get(client.sessionId)!;
        const last = hand[hand.length - 1];
        if (top && canPlayNoMercy(last, top, this.state.currentColor as UnoColor, 0)) {
          playable = true;
        }
      }
      this.syncHandCounts();
      this.sendHand(client);
      this.state.deckRemaining = this.deck.length;
      if (!playable) {
        this.setStatus(`${this.playerName(client.sessionId)} drew ${drew} — still can't play`);
        this.advanceTurn();
      } else {
        this.setStatus(`${this.playerName(client.sessionId)} drew until playable`);
      }
      return;
    }

    this.drawToHand(client.sessionId, 1);
    this.syncHandCounts();
    this.sendHand(client);
    this.state.deckRemaining = this.deck.length;

    const hand = this.hands.get(client.sessionId)!;
    const top = this.currentTop();
    const last = hand[hand.length - 1];
    const canPlay =
      top && canPlayClassic(last, top, this.state.currentColor as UnoColor, 0);

    if (!canPlay) {
      this.advanceTurn();
    }
  }

  private handleCallUno(client: Client) {
    if (this.state.unoWatchSessionId === client.sessionId) {
      this.state.unoWatchSessionId = "";
      client.send("unoOk", {});
    }
  }

  private handleCatchUno(client: Client, targetId?: string) {
    if (typeof targetId !== "string") return;
    if (this.state.unoWatchSessionId !== targetId) return;
    this.drawToHand(targetId, 2);
    this.state.unoWatchSessionId = "";
    this.syncHandCounts();
    const target = this.clients.find((c) => c.sessionId === targetId);
    if (target) this.sendHand(target);
    this.setStatus(`${this.playerName(client.sessionId)} caught ${this.playerName(targetId)}!`);
  }

  private applyCardEffect(card: UnoCard, wildColor: UnoColor | null) {
    const name = this.playerName(this.state.currentPlayerId);

    switch (card.value) {
      case "skip":
        this.setStatus(`${name} played Skip`);
        this.advanceTurn();
        break;
      case "skipAll":
        if (this.mode === "noMercy") {
          this.setStatus(`${name} played Skip Everyone!`);
          this.advanceTurn();
        }
        break;
      case "reverse":
        this.state.direction *= -1;
        this.setStatus(
          `${name} played Reverse${this.turnOrder.length === 2 ? " (acts as Skip)" : ""}`
        );
        this.advanceTurn();
        break;
      case "0":
        if (this.mode === "noMercy") {
          this.rotateHands();
          this.setStatus(`${name} played 0 — everyone passed hands!`);
        }
        break;
      case "1":
        if (this.mode === "noMercy") {
          for (const id of this.turnOrder) {
            if (id !== this.state.currentPlayerId) this.drawToHand(id, 1);
          }
          this.broadcastHands();
          this.setStatus(`${name} played 1 — everyone else draws!`);
        }
        break;
      case "7":
        if (this.mode === "noMercy" && card.color !== "w") {
          this.wildColorLock = card.color as UnoColor;
          this.setStatus(`${name} played 7 — draw until ${card.color.toUpperCase()}!`);
        }
        break;
      case "wildColor":
        if (wildColor) {
          this.wildColorLock = wildColor;
          this.setStatus(`${name} chose ${wildColor} — next player draws until match!`);
          this.advanceTurn();
        }
        break;
      case "draw2":
      case "draw1":
      case "draw5":
      case "wild4":
      case "wildDraw2":
        this.setStatus(`${name} played ${cardLabel(card)} (stack: ${this.state.drawStack})`);
        break;
      default:
        this.setStatus(`${name} played ${cardLabel(card)}`);
        break;
    }
  }

  private rotateHands() {
    if (this.turnOrder.length < 2) return;
    const handsList = this.turnOrder.map((id) => this.hands.get(id) ?? []);
    const len = handsList.length;
    const rotated =
      this.state.direction === 1
        ? [handsList[len - 1], ...handsList.slice(0, len - 1)]
        : [...handsList.slice(1), handsList[0]];
    this.turnOrder.forEach((id, i) => this.hands.set(id, rotated[i]));
    this.syncHandCounts();
    this.broadcastHands();
  }

  private isActionCard(card: UnoCard): boolean {
    return (
      ["skip", "reverse", "skipAll", "draw2", "draw1", "draw5", "wild4", "wildDraw2", "wildColor"].includes(
        card.value
      ) ||
      (this.mode === "noMercy" && ["0", "1", "7"].includes(card.value))
    );
  }

  private advanceTurn() {
    if (this.state.phase !== "playing") return;

    if (this.state.unoWatchSessionId) {
      const watched = this.state.unoWatchSessionId;
      if ((this.hands.get(watched)?.length ?? 0) === 1) {
        this.drawToHand(watched, 2);
        const c = this.clients.find((x) => x.sessionId === watched);
        if (c) this.sendHand(c);
        this.setStatus(`${this.playerName(watched)} forgot UNO! (+2)`);
      }
      this.state.unoWatchSessionId = "";
    }

    const idx = this.turnOrder.indexOf(this.state.currentPlayerId);
    if (idx < 0) return;

    let next = idx;
    let steps = 1;
    if (this.discard[this.discard.length - 1]?.value === "skipAll" && this.mode === "noMercy") {
      steps = this.turnOrder.length - 1;
    }

    for (let i = 0; i < steps; i++) {
      next = (next + this.state.direction + this.turnOrder.length) % this.turnOrder.length;
    }

    this.state.currentPlayerId = this.turnOrder[next];
    const nextId = this.state.currentPlayerId;

    if (this.wildColorLock && this.mode === "noMercy") {
      let drew = 0;
      while (drew < 25) {
        const hand = this.hands.get(nextId)!;
        const hasColor = hand.some((c) => c.color === this.wildColorLock || isWildCard(c));
        if (hasColor) break;
        this.drawToHand(nextId, 1);
        drew++;
      }
      this.wildColorLock = null;
      this.syncHandCounts();
      const client = this.clients.find((c) => c.sessionId === nextId);
      if (client) this.sendHand(client);
      if (drew > 0) {
        this.setStatus(`${this.playerName(nextId)} drew ${drew} for color lock`);
      }
    }

    this.setStatus(`${this.playerName(nextId)}'s turn`);
  }

  private declareWinner(sessionId: string) {
    this.state.phase = "finished";
    this.state.winnerSessionId = sessionId;
    this.state.currentPlayerId = "";
    this.setStatus(`${this.playerName(sessionId)} wins! 🎉`);
    this.broadcast("gameOver", { winnerSessionId: sessionId, winnerName: this.playerName(sessionId) });
  }

  private endToLobby(message: string) {
    this.state.phase = "lobby";
    this.state.gameMode = "";
    this.state.statusMessage = message;
    this.broadcast("backToLobby", { message });
  }

  private drawToHand(sessionId: string, count: number) {
    const hand = this.hands.get(sessionId);
    if (!hand) return;
    for (let i = 0; i < count; i++) {
      const card = this.drawFromDeck();
      if (card) hand.push(card);
    }
  }

  private drawFromDeck(): UnoCard | null {
    if (this.deck.length === 0) {
      if (this.discard.length <= 1) return null;
      const top = this.discard.pop()!;
      this.deck = shuffle(this.discard);
      this.discard = [top];
    }
    return this.deck.pop() ?? null;
  }

  private currentTop(): UnoCard | null {
    return this.discard[this.discard.length - 1] ?? null;
  }

  private syncTopCard(card: UnoCard) {
    this.state.topCard.id = card.id;
    this.state.topCard.color = card.color;
    this.state.topCard.value = card.value;
  }

  private syncHandCounts() {
    for (const [sessionId, hand] of this.hands) {
      this.state.handCounts.set(sessionId, hand.length);
    }
  }

  private sendHand(client: Client) {
    const hand = this.hands.get(client.sessionId) ?? [];
    client.send("handUpdate", { cards: hand });
  }

  private broadcastHands() {
    for (const client of this.clients) {
      this.sendHand(client);
    }
  }

  private setStatus(msg: string) {
    this.state.statusMessage = msg;
  }

  private playerName(sessionId: string): string {
    return this.state.members.get(sessionId)?.username ?? "Player";
  }
}
