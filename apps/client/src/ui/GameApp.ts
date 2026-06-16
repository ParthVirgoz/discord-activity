import type { Room } from "@colyseus/sdk";
import { Callbacks } from "@colyseus/sdk";
import type { GameRoomState, GamePhase } from "../schema.js";
import { configureRoomResilience, startRoomKeepAlive, bindNetworkRecoveryHandlers } from "../utils/roomConnection.js";

export class GameApp {
  private room: Room<GameRoomState>;
  private root: HTMLElement;
  private destroyed = false;

  constructor(room: Room<GameRoomState>, root: HTMLElement) {
    this.room = room;
    this.root = root;
    this.renderShell();
    configureRoomResilience(room);
    startRoomKeepAlive(room);
    bindNetworkRecoveryHandlers(room, () => this.renderAll());
    this.bindMessages();
    this.bindStateListeners();
    this.renderAll();
  }

  private renderShell() {
    this.root.innerHTML = `
      <div class="game-app">
        <header class="game-header">
          <div class="game-brand">
            <span class="game-logo">⭕</span>
            <div>
              <h1 class="game-title">Tic-Tac-Toe</h1>
              <p class="game-subtitle">Voice channel party game</p>
            </div>
          </div>
          <span id="connection-badge" class="connection-badge connected">Connected</span>
        </header>
        <main class="game-main">
          <section class="game-board-section">
            <p id="status-line" class="status-line">Connecting…</p>
            <div id="game-board" class="game-board" role="grid" aria-label="Tic-tac-toe board"></div>
            <div class="game-actions">
              <button type="button" id="btn-rematch" class="btn btn-primary hidden">Play again</button>
              <button type="button" id="btn-leave-seat" class="btn btn-ghost hidden">Leave seat</button>
            </div>
          </section>
          <aside class="game-sidebar">
            <h2 class="sidebar-title">Players</h2>
            <ul id="member-list" class="member-list"></ul>
            <p class="sidebar-hint">First two players in the voice channel become X and O. Everyone else watches.</p>
          </aside>
        </main>
      </div>
    `;

    this.root.querySelector("#btn-rematch")?.addEventListener("click", () => {
      this.room.send("rematch");
    });
    this.root.querySelector("#btn-leave-seat")?.addEventListener("click", () => {
      this.room.send("leaveSeat");
    });
  }

  private bindMessages() {
    this.room.onMessage("roomJoined", () => this.renderAll());
    this.room.onMessage("reconnected", () => this.renderAll());
    this.room.onMessage("gameOver", () => this.renderAll());
    this.room.onMessage("rematch", () => this.renderAll());

    this.room.onLeave(() => {
      if (this.destroyed) return;
      this.setConnectionStatus("disconnected");
      this.root.innerHTML = `
        <div class="error-screen">
          <p>Disconnected from the game room.</p>
          <p class="muted">Re-open the Activity from your voice channel to play again.</p>
        </div>
      `;
    });
  }

  private bindStateListeners() {
    const callbacks = Callbacks.get(this.room);
    if (this.room.state.members) {
      callbacks.onAdd("members", () => this.renderAll());
      callbacks.onRemove("members", () => this.renderAll());
    }
    callbacks.onChange(this.room.state, () => this.renderAll());
  }

  private mySymbol(): "" | "X" | "O" {
    const id = this.room.sessionId;
    if (id === this.room.state.playerXSessionId) return "X";
    if (id === this.room.state.playerOSessionId) return "O";
    return "";
  }

  private renderAll() {
    if (this.destroyed) return;
    this.renderStatus();
    this.renderBoard();
    this.renderMembers();
    this.renderActions();
  }

  private renderStatus() {
    const el = this.root.querySelector("#status-line");
    if (!el) return;

    const s = this.room.state;
    const me = this.mySymbol();
    const phase = s.phase as GamePhase;

    if (phase === "waiting") {
      if (!s.playerXSessionId || !s.playerOSessionId) {
        el.textContent = me
          ? "Waiting for an opponent to join the voice channel…"
          : "Waiting for two players — open the Activity in voice to play.";
      } else {
        el.textContent = "Starting…";
      }
      return;
    }

    if (phase === "finished") {
      if (s.winner === "draw") {
        el.textContent = "Draw! Tap Play again for a rematch.";
      } else if (me && s.winner === me) {
        el.textContent = "You win! 🎉";
      } else if (me) {
        el.textContent = "You lose. Better luck next round!";
      } else {
        el.textContent = `${s.winner} wins!`;
      }
      return;
    }

    if (me) {
      el.textContent =
        s.currentTurnSessionId === this.room.sessionId
          ? "Your turn — pick a square"
          : "Opponent's turn…";
    } else {
      const turnSymbol =
        s.currentTurnSessionId === s.playerXSessionId
          ? "X"
          : s.currentTurnSessionId === s.playerOSessionId
            ? "O"
            : "?";
      el.textContent = `${turnSymbol}'s turn`;
    }
  }

  private renderBoard() {
    const boardEl = this.root.querySelector("#game-board");
    if (!boardEl) return;

    const s = this.room.state;
    const me = this.mySymbol();
    const myTurn = s.phase === "playing" && s.currentTurnSessionId === this.room.sessionId;

    boardEl.innerHTML = "";
    for (let i = 0; i < 9; i++) {
      const cell = s.board[i] ?? "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cell" + (cell ? ` cell--${cell.toLowerCase()}` : "");
      btn.setAttribute("role", "gridcell");
      btn.setAttribute("aria-label", cell ? `Square ${i + 1}, ${cell}` : `Square ${i + 1}, empty`);
      btn.textContent = cell;
      btn.disabled = !me || !myTurn || !!cell || s.phase !== "playing";
      btn.addEventListener("click", () => {
        if (!btn.disabled) this.room.send("placeMark", { index: i });
      });
      boardEl.appendChild(btn);
    }
  }

  private renderMembers() {
    const list = this.root.querySelector("#member-list");
    if (!list) return;

    const s = this.room.state;
    list.innerHTML = "";

    s.members.forEach((member, sessionId) => {
      const li = document.createElement("li");
      li.className = "member-row" + (sessionId === this.room.sessionId ? " member-row--me" : "");

      let role = "Spectator";
      if (sessionId === s.playerXSessionId) role = "X";
      if (sessionId === s.playerOSessionId) role = "O";

      const avatar = member.avatarUrl
        ? `<img class="member-avatar" src="${this.escapeAttr(member.avatarUrl)}" alt="" />`
        : `<span class="member-avatar member-avatar--fallback">${this.escapeHtml(member.username.charAt(0).toUpperCase())}</span>`;

      li.innerHTML = `
        ${avatar}
        <span class="member-name">${this.escapeHtml(member.username)}${sessionId === this.room.sessionId ? " (you)" : ""}</span>
        <span class="member-role member-role--${role.toLowerCase()}">${role}</span>
      `;
      list.appendChild(li);
    });
  }

  private renderActions() {
    const rematch = this.root.querySelector("#btn-rematch");
    const leaveSeat = this.root.querySelector("#btn-leave-seat");
    const me = this.mySymbol();
    const finished = this.room.state.phase === "finished";

    rematch?.classList.toggle("hidden", !(me && finished));
    leaveSeat?.classList.toggle("hidden", !me);
  }

  private setConnectionStatus(state: "connected" | "connecting" | "disconnected") {
    const badge = this.root.querySelector("#connection-badge") as HTMLElement | null;
    if (!badge) return;
    badge.className = `connection-badge ${state}`;
    badge.textContent =
      state === "connected" ? "Connected" : state === "connecting" ? "Connecting…" : "Disconnected";
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private escapeAttr(text: string): string {
    return text.replace(/"/g, "&quot;");
  }

  destroy() {
    this.destroyed = true;
  }
}
