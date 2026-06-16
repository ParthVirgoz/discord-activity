import type { Room } from "@colyseus/sdk";
import { Callbacks } from "@colyseus/sdk";
import type { UnoRoomState } from "../schema.js";
import { configureRoomResilience, startRoomKeepAlive, bindNetworkRecoveryHandlers } from "../utils/roomConnection.js";
import { type UnoCard, type UnoColor, cardLabel, canPlayCard, isWild, COLOR_NAME } from "../uno/cardUi.js";

const MIN_PLAYERS = 2;

export class UnoApp {
  private room: Room<UnoRoomState>;
  private root: HTMLElement;
  private destroyed = false;
  private myHand: UnoCard[] = [];
  private pendingWildCardId: string | null = null;

  constructor(room: Room<UnoRoomState>, root: HTMLElement) {
    this.room = room;
    this.root = root;
    this.renderShell();
    configureRoomResilience(room);
    startRoomKeepAlive(room);
    bindNetworkRecoveryHandlers(room, () => this.renderAll());
    this.bindMessages();
    this.bindState();
    this.renderAll();
  }

  private renderShell() {
    this.root.innerHTML = `
      <div class="uno-app">
        <header class="game-header">
          <div class="game-brand">
            <span class="game-logo">🃏</span>
            <div>
              <h1 class="game-title">UNO Party</h1>
              <p class="game-subtitle">Classic &amp; No Mercy — voice channel card game</p>
            </div>
          </div>
          <span id="mode-badge" class="round-badge">Lobby</span>
        </header>
        <p id="status-line" class="status-line">Connecting…</p>
        <div id="table-area" class="table-area"></div>
        <div id="hand-area" class="hand-area hidden"></div>
        <div id="action-bar" class="action-bar hidden"></div>
        <div id="color-modal" class="color-modal hidden" role="dialog" aria-label="Pick a color">
          <div class="color-modal-inner">
            <p>Choose color</p>
            <div class="color-picks">
              <button type="button" data-color="r" class="color-pick color-pick--r">Red</button>
              <button type="button" data-color="g" class="color-pick color-pick--g">Green</button>
              <button type="button" data-color="b" class="color-pick color-pick--b">Blue</button>
              <button type="button" data-color="y" class="color-pick color-pick--y">Yellow</button>
            </div>
            <button type="button" id="color-cancel" class="btn btn-ghost">Cancel</button>
          </div>
        </div>
      </div>
    `;

    this.root.querySelector("#color-cancel")?.addEventListener("click", () => {
      this.pendingWildCardId = null;
      this.hideColorModal();
    });
    this.root.querySelectorAll(".color-pick").forEach((btn) => {
      btn.addEventListener("click", () => {
        const color = (btn as HTMLElement).dataset.color as UnoColor;
        if (this.pendingWildCardId && color) {
          this.room.send("playCard", { cardId: this.pendingWildCardId, wildColor: color });
          this.pendingWildCardId = null;
          this.hideColorModal();
        }
      });
    });
  }

  private bindMessages() {
    this.room.onMessage("handUpdate", (data: { cards: UnoCard[] }) => {
      this.myHand = data.cards ?? [];
      this.renderHand();
    });
    this.room.onMessage("roomJoined", () => this.renderAll());
    this.room.onMessage("reconnected", () => this.renderAll());
    this.room.onMessage("gameStarted", () => this.renderAll());
    this.room.onMessage("gameOver", () => this.renderAll());
    this.room.onMessage("backToLobby", () => {
      this.myHand = [];
      this.renderAll();
    });

    this.room.onLeave(() => {
      if (this.destroyed) return;
      this.root.innerHTML = `<div class="error-screen"><p>Disconnected.</p><p class="muted">Re-open from voice channel.</p></div>`;
    });
  }

  private bindState() {
    const cb = Callbacks.get(this.room);
    cb.onAdd("members", () => this.renderAll());
    cb.onRemove("members", () => this.renderAll());
    cb.onChange(this.room.state, () => this.renderAll());
  }

  private isHost(): boolean {
    return this.room.state.hostSessionId === this.room.sessionId;
  }

  private isMyTurn(): boolean {
    return this.room.state.currentPlayerId === this.room.sessionId;
  }

  private renderAll() {
    if (this.destroyed) return;
    this.renderHeader();
    this.renderTable();
    this.renderHand();
    this.renderActions();
  }

  private renderHeader() {
    const badge = this.root.querySelector("#mode-badge");
    const status = this.root.querySelector("#status-line");
    const s = this.room.state;
    if (badge) {
      if (s.phase === "lobby") badge.textContent = "Lobby";
      else if (s.gameMode === "noMercy") badge.textContent = "No Mercy";
      else badge.textContent = "Classic UNO";
    }
    if (status) {
      status.textContent = s.statusMessage || (s.phase === "lobby" ? this.lobbyStatus() : "");
    }
  }

  private lobbyStatus(): string {
    const n = this.room.state.members?.size ?? 0;
    if (n < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players (${n}/${MIN_PLAYERS})`;
    return this.isHost() ? "Pick Classic UNO or UNO No Mercy to start." : "Waiting for host…";
  }

  private renderTable() {
    const area = this.root.querySelector("#table-area");
    if (!area) return;
    const s = this.room.state;

    if (s.phase === "lobby" || s.phase === "finished") {
      area.innerHTML = this.renderLobby();
      this.bindLobbyButtons();
      return;
    }

    const top = s.topCard;
    const drawStack = s.drawStack;
    let opponents = "";
    s.members.forEach((member, sessionId) => {
      if (sessionId === this.room.sessionId) return;
      const count = s.handCounts.get(sessionId) ?? 0;
      const isTurn = sessionId === s.currentPlayerId;
      const avatar = member.avatarUrl
        ? `<img class="opp-avatar" src="${this.escAttr(member.avatarUrl)}" alt="" />`
        : `<span class="opp-avatar opp-avatar--fb">${this.esc(member.username.charAt(0))}</span>`;
      opponents += `
        <div class="opponent${isTurn ? " opponent--turn" : ""}">
          ${avatar}
          <span class="opp-name">${this.esc(member.username)}</span>
          <span class="opp-cards">${count} 🃏</span>
          ${count === 1 ? `<button type="button" class="btn-catch" data-catch="${sessionId}">Catch!</button>` : ""}
        </div>`;
    });

    area.innerHTML = `
      <div class="opponents">${opponents}</div>
      <div class="pile-area">
        <div class="pile deck-pile" title="Cards left: ${s.deckRemaining}">
          <span class="pile-label">Deck</span>
          <span class="pile-count">${s.deckRemaining}</span>
        </div>
        <div class="pile discard-pile card card--${top.color}" data-top>
          <span class="card-corner">${top.color !== "w" ? top.color.toUpperCase() : "W"}</span>
          <span class="card-face">${this.esc(this.labelTop(top))}</span>
          ${drawStack > 0 ? `<span class="stack-badge">+${drawStack}</span>` : ""}
        </div>
        <div class="color-indicator color-indicator--${s.currentColor}">
          ${COLOR_NAME[s.currentColor as UnoColor] ?? s.currentColor}
        </div>
      </div>
      <p class="turn-hint">${this.isMyTurn() ? "Your turn!" : `Waiting for ${this.playerName(s.currentPlayerId)}…`}</p>
    `;

    area.querySelectorAll(".btn-catch").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = (btn as HTMLElement).dataset.catch;
        if (id) this.room.send("catchUno", { targetSessionId: id });
      });
    });
  }

  private renderLobby(): string {
    const s = this.room.state;
    const n = s.members?.size ?? 0;
    if (s.phase === "finished" && s.winnerSessionId) {
      return `
        <div class="lobby-card lobby-card--win">
          <h2>🎉 ${this.esc(this.playerName(s.winnerSessionId))} wins!</h2>
          ${this.isHost() ? `<button type="button" id="btn-again" class="btn btn-primary btn-lg">Back to lobby</button>` : ""}
        </div>`;
    }
    return `
      <div class="lobby-card">
        <h2>Choose game mode</h2>
        <p>${n} player${n === 1 ? "" : "s"} in voice · ${MIN_PLAYERS}–10 supported</p>
        <ul class="mode-list">
          <li><strong>Classic UNO</strong> — standard rules, +2 stacking</li>
          <li><strong>UNO No Mercy</strong> — +1/+5, stack penalties, draw until playable, brutal specials</li>
        </ul>
        ${
          this.isHost() && n >= MIN_PLAYERS
            ? `<div class="mode-buttons">
            <button type="button" id="start-classic" class="btn btn-primary btn-lg">Classic UNO</button>
            <button type="button" id="start-nomercy" class="btn btn-danger btn-lg">UNO No Mercy</button>
          </div>`
            : `<p class="muted">${n < MIN_PLAYERS ? `Need ${MIN_PLAYERS - n} more player(s).` : "Waiting for host…"}</p>`
        }
      </div>`;
  }

  private bindLobbyButtons() {
    this.root.querySelector("#start-classic")?.addEventListener("click", () => {
      this.room.send("startGame", { mode: "classic" });
    });
    this.root.querySelector("#start-nomercy")?.addEventListener("click", () => {
      this.room.send("startGame", { mode: "noMercy" });
    });
    this.root.querySelector("#btn-again")?.addEventListener("click", () => {
      this.room.send("playAgain");
    });
  }

  private renderHand() {
    const area = this.root.querySelector("#hand-area");
    if (!area) return;
    const s = this.room.state;
    if (s.phase !== "playing") {
      area.classList.add("hidden");
      return;
    }
    area.classList.remove("hidden");

    const top = s.topCard;
    const playable = this.isMyTurn();

    area.innerHTML = `<div class="hand-scroll">${this.myHand
      .map((card) => {
        const ok =
          playable &&
          canPlayCard(card, top as UnoCard, s.currentColor as UnoColor, s.drawStack, s.gameMode);
        return `<button type="button" class="card card--${card.color}${ok ? " card--playable" : ""}" data-id="${this.escAttr(card.id)}" ${ok ? "" : "disabled"}>
          <span class="card-corner">${card.color !== "w" ? card.color.toUpperCase() : "W"}</span>
          <span class="card-face">${this.esc(cardLabel(card))}</span>
        </button>`;
      })
      .join("")}</div>`;

    area.querySelectorAll(".card--playable").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = (btn as HTMLElement).dataset.id;
        if (!id) return;
        const card = this.myHand.find((c) => c.id === id);
        if (!card) return;
        if (isWild(card)) {
          this.pendingWildCardId = id;
          this.showColorModal();
        } else {
          this.room.send("playCard", { cardId: id });
        }
      });
    });
  }

  private renderActions() {
    const bar = this.root.querySelector("#action-bar");
    if (!bar) return;
    const s = this.room.state;
    if (s.phase !== "playing") {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");

    const myTurn = this.isMyTurn();
    bar.innerHTML = `
      <button type="button" id="btn-draw" class="btn btn-primary" ${myTurn ? "" : "disabled"}>
        ${s.drawStack > 0 ? `Draw +${s.drawStack}` : "Draw"}
      </button>
      <button type="button" id="btn-uno" class="btn btn-warning" ${this.myHand.length === 1 ? "" : "disabled"}>UNO!</button>
    `;

    bar.querySelector("#btn-draw")?.addEventListener("click", () => {
      if (myTurn) this.room.send("drawCard");
    });
    bar.querySelector("#btn-uno")?.addEventListener("click", () => {
      this.room.send("callUno");
    });
  }

  private showColorModal() {
    this.root.querySelector("#color-modal")?.classList.remove("hidden");
  }

  private hideColorModal() {
    this.root.querySelector("#color-modal")?.classList.add("hidden");
  }

  private labelTop(top: { color: string; value: string }): string {
    return cardLabel({ id: "", color: top.color as UnoColor, value: top.value });
  }

  private playerName(sessionId: string): string {
    return this.room.state.members.get(sessionId)?.username ?? "Player";
  }

  private esc(t: string): string {
    const d = document.createElement("div");
    d.textContent = t;
    return d.innerHTML;
  }

  private escAttr(t: string): string {
    return t.replace(/"/g, "&quot;");
  }

  destroy() {
    this.destroyed = true;
  }
}
