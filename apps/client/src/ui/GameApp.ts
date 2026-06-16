import type { Room } from "@colyseus/sdk";
import { Callbacks } from "@colyseus/sdk";
import type { GameRoomState, GamePhase } from "../schema.js";
import { configureRoomResilience, startRoomKeepAlive, bindNetworkRecoveryHandlers } from "../utils/roomConnection.js";

type RevealOption = {
  id: string;
  text: string;
  isTruth: boolean;
  authorSessionId: string | null;
  votes: number;
};

const MIN_PLAYERS = 3;

export class GameApp {
  private room: Room<GameRoomState>;
  private root: HTMLElement;
  private destroyed = false;
  private lastReveal: {
    truthOptionId: string;
    options: RevealOption[];
    roundGains: Record<string, number>;
  } | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private submittedThisRound = false;
  private myAnswerText = "";
  private votedThisRound = false;

  constructor(room: Room<GameRoomState>, root: HTMLElement) {
    this.room = room;
    this.root = root;
    this.renderShell();
    configureRoomResilience(room);
    startRoomKeepAlive(room);
    bindNetworkRecoveryHandlers(room, () => this.renderAll());
    this.bindMessages();
    this.bindStateListeners();
    this.tickTimer = setInterval(() => this.renderTimer(), 1000);
    this.renderAll();
  }

  private resetRoundLocal() {
    this.submittedThisRound = false;
    this.myAnswerText = "";
    this.votedThisRound = false;
    this.lastReveal = null;
  }

  private renderShell() {
    this.root.innerHTML = `
      <div class="game-app">
        <header class="game-header">
          <div class="game-brand">
            <span class="game-logo">🎭</span>
            <div>
              <h1 class="game-title">Bluff Party</h1>
              <p class="game-subtitle">Find the truth. Fool your friends.</p>
            </div>
          </div>
          <div class="header-meta">
            <span id="round-badge" class="round-badge">Lobby</span>
            <span id="connection-badge" class="connection-badge connected">Connected</span>
          </div>
        </header>
        <main class="game-main">
          <section class="game-stage">
            <p id="status-line" class="status-line">Connecting…</p>
            <p id="timer-line" class="timer-line hidden"></p>
            <div id="stage-content" class="stage-content"></div>
            <div id="game-actions" class="game-actions"></div>
          </section>
          <aside class="game-sidebar">
            <h2 class="sidebar-title">Scoreboard</h2>
            <ol id="score-list" class="score-list"></ol>
            <h2 class="sidebar-title sidebar-title--spaced">In voice</h2>
            <ul id="member-list" class="member-list"></ul>
            <p class="sidebar-hint">Party game for 3–12 players — like Fibbage on Discord. Write lies, spot the truth, climb the board.</p>
          </aside>
        </main>
      </div>
    `;
  }

  private bindMessages() {
    this.room.onMessage("roomJoined", () => this.renderAll());
    this.room.onMessage("reconnected", () => this.renderAll());
    this.room.onMessage("roundStarted", () => {
      this.resetRoundLocal();
      this.renderAll();
    });
    this.room.onMessage("roundReveal", (data: {
      truthOptionId: string;
      options: RevealOption[];
      roundGains: Record<string, number>;
    }) => {
      this.lastReveal = data;
      this.renderAll();
    });
    this.room.onMessage("gameEnded", () => this.renderAll());
    this.room.onMessage("backToLobby", () => {
      this.resetRoundLocal();
      this.renderAll();
    });

    this.room.onLeave(() => {
      if (this.destroyed) return;
      if (this.tickTimer) clearInterval(this.tickTimer);
      this.root.innerHTML = `
        <div class="error-screen">
          <p>Disconnected from the game.</p>
          <p class="muted">Re-open the Activity from your voice channel.</p>
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

  private isHost(): boolean {
    return this.room.state.hostSessionId === this.room.sessionId;
  }

  private renderAll() {
    if (this.destroyed) return;
    this.renderRoundBadge();
    this.renderStatus();
    this.renderTimer();
    this.renderStage();
    this.renderActions();
    this.renderScores();
    this.renderMembers();
  }

  private renderRoundBadge() {
    const el = this.root.querySelector("#round-badge");
    if (!el) return;
    const s = this.room.state;
    if (s.phase === "lobby") el.textContent = "Lobby";
    else if (s.phase === "ended") el.textContent = "Final";
    else el.textContent = `Round ${s.round}/${s.maxRounds}`;
  }

  private renderStatus() {
    const el = this.root.querySelector("#status-line");
    if (!el) return;
    const s = this.room.state;
    const count = s.members?.size ?? 0;

    switch (s.phase as GamePhase) {
      case "lobby":
        el.textContent =
          count < MIN_PLAYERS
            ? `Need ${MIN_PLAYERS - count} more player${MIN_PLAYERS - count === 1 ? "" : "s"} (${count}/${MIN_PLAYERS})`
            : this.isHost()
              ? "Ready! Start when everyone's in voice."
              : "Waiting for the host to start…";
        break;
      case "submit":
        el.textContent = "Write a convincing lie — fool the room!";
        break;
      case "vote":
        el.textContent = "Pick the real answer (+2). Earn +1 for each vote on your lie.";
        break;
      case "reveal":
        el.textContent = "Round results";
        break;
      case "ended":
        el.textContent = "Game over!";
        break;
    }
  }

  private renderTimer() {
    const el = this.root.querySelector("#timer-line");
    if (!el) return;
    const s = this.room.state;
    if ((s.phase !== "submit" && s.phase !== "vote") || !s.phaseEndsAt) {
      el.classList.add("hidden");
      return;
    }
    const sec = Math.max(0, Math.ceil((s.phaseEndsAt - Date.now()) / 1000));
    el.textContent = sec > 0 ? `${sec}s left` : "Time's up…";
    el.classList.remove("hidden");
  }

  private renderStage() {
    const stage = this.root.querySelector("#stage-content");
    if (!stage) return;
    const s = this.room.state;

    switch (s.phase as GamePhase) {
      case "lobby":
      case "ended":
        stage.innerHTML = this.renderLobbyCard();
        break;
      case "submit":
        stage.innerHTML = this.renderSubmitCard();
        this.bindSubmitForm();
        break;
      case "vote":
        stage.innerHTML = this.renderVoteCard();
        this.bindVoteButtons();
        break;
      case "reveal":
        stage.innerHTML = this.renderRevealCard();
        break;
    }
  }

  private renderLobbyCard(): string {
    const s = this.room.state;
    if (s.phase === "ended") {
      const winner = this.getSortedScores()[0];
      return `
        <div class="prompt-card prompt-card--celebrate">
          <p class="prompt-label">🏆 Winner</p>
          <p class="prompt-text">${winner ? this.escapeHtml(winner.username) : "Everyone"}</p>
          <p class="prompt-sub">${winner?.points ?? 0} points</p>
        </div>`;
    }
    return `
      <div class="prompt-card">
        <p class="prompt-label">How to play</p>
        <ol class="how-to">
          <li>Get a fill-in-the-blank prompt</li>
          <li>Submit a <strong>fake answer</strong> that sounds believable</li>
          <li>Vote for the answer you think is <strong>true</strong></li>
          <li>Score points for finding truth &amp; fooling friends</li>
        </ol>
      </div>`;
  }

  private renderSubmitCard(): string {
    const s = this.room.state;
    if (this.submittedThisRound) {
      return `
        <div class="prompt-card">
          <p class="prompt-label">Fill in the blank</p>
          <p class="prompt-text">${this.escapeHtml(s.prompt)}</p>
        </div>
        <p class="waiting-note">Your lie: "${this.escapeHtml(this.myAnswerText)}" — waiting for others (${s.submittedCount}/${s.members.size})</p>`;
    }
    return `
      <div class="prompt-card">
        <p class="prompt-label">Fill in the blank</p>
        <p class="prompt-text">${this.escapeHtml(s.prompt)}</p>
      </div>
      <form id="submit-form" class="submit-form">
        <input id="answer-input" class="text-input" maxlength="72" placeholder="Your convincing lie…" autocomplete="off" />
        <button type="submit" class="btn btn-primary">Submit lie</button>
      </form>`;
  }

  private renderVoteCard(): string {
    const s = this.room.state;
    let html = `<div class="prompt-card prompt-card--compact"><p class="prompt-text">${this.escapeHtml(s.prompt)}</p></div><div class="vote-grid">`;

    s.options.forEach((opt) => {
      const isMine = this.myAnswerText && opt.text === this.myAnswerText;
      html += `
        <button type="button" class="vote-option" data-id="${this.escapeAttr(opt.id)}" ${isMine || this.votedThisRound ? "disabled" : ""}>
          ${this.escapeHtml(opt.text)}
          ${isMine ? '<span class="vote-tag">Your lie</span>' : ""}
        </button>`;
    });

    html += "</div>";
    if (this.votedThisRound) {
      html += `<p class="waiting-note">Vote locked (${s.votedCount}/${s.members.size})…</p>`;
    }
    return html;
  }

  private renderRevealCard(): string {
    if (!this.lastReveal) return `<p class="waiting-note">Tallying votes…</p>`;

    const { options, truthOptionId, roundGains } = this.lastReveal;
    const myGain = roundGains[this.room.sessionId] ?? 0;

    let html = `<div class="reveal-list">`;
    for (const opt of options) {
      const isTruth = opt.id === truthOptionId;
      const author =
        opt.authorSessionId && this.room.state.members.get(opt.authorSessionId)?.username;
      html += `
        <div class="reveal-row${isTruth ? " reveal-row--truth" : ""}">
          <p class="reveal-text">${this.escapeHtml(opt.text)}</p>
          <div class="reveal-meta">
            ${isTruth ? '<span class="reveal-badge reveal-badge--truth">TRUTH</span>' : author ? `<span class="reveal-badge">${this.escapeHtml(author)}</span>` : '<span class="reveal-badge">Decoy</span>'}
            <span class="reveal-votes">${opt.votes} vote${opt.votes === 1 ? "" : "s"}</span>
          </div>
        </div>`;
    }
    html += `</div><p class="round-gain">${myGain > 0 ? `+${myGain} points this round!` : "No points this round."}</p>`;
    return html;
  }

  private bindSubmitForm() {
    const form = this.root.querySelector("#submit-form");
    if (!form || this.submittedThisRound) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = this.root.querySelector("#answer-input") as HTMLInputElement | null;
      const text = input?.value.trim();
      if (!text || text.length < 2) return;
      this.submittedThisRound = true;
      this.myAnswerText = text;
      this.room.send("submitAnswer", { text });
      this.renderAll();
    });
  }

  private bindVoteButtons() {
    if (this.votedThisRound) return;
    this.root.querySelectorAll(".vote-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = (btn as HTMLElement).dataset.id;
        if (!id) return;
        this.votedThisRound = true;
        this.room.send("vote", { optionId: id });
        this.renderAll();
      });
    });
  }

  private renderActions() {
    const actions = this.root.querySelector("#game-actions");
    if (!actions) return;
    const s = this.room.state;

    if (s.phase === "lobby" && this.isHost() && (s.members?.size ?? 0) >= MIN_PLAYERS) {
      actions.innerHTML = `<button type="button" id="btn-start" class="btn btn-primary btn-lg">Start game</button>`;
      actions.querySelector("#btn-start")?.addEventListener("click", () => this.room.send("startGame"));
      return;
    }

    if (s.phase === "ended" && this.isHost()) {
      actions.innerHTML = `<button type="button" id="btn-again" class="btn btn-primary btn-lg">Play again</button>`;
      actions.querySelector("#btn-again")?.addEventListener("click", () => this.room.send("playAgain"));
      return;
    }

    actions.innerHTML = "";
  }

  private getSortedScores() {
    const rows: { sessionId: string; username: string; points: number }[] = [];
    this.room.state.scores?.forEach((score, sessionId) => {
      if (!this.room.state.members.has(sessionId)) return;
      rows.push({
        sessionId,
        username: this.room.state.members.get(sessionId)?.username ?? "Player",
        points: score.points,
      });
    });
    return rows.sort((a, b) => b.points - a.points);
  }

  private renderScores() {
    const list = this.root.querySelector("#score-list");
    if (!list) return;
    list.innerHTML = this.getSortedScores()
      .map(
        (row, i) => `
      <li class="score-row${row.sessionId === this.room.sessionId ? " score-row--me" : ""}">
        <span class="score-rank">${i + 1}</span>
        <span class="score-name">${this.escapeHtml(row.username)}</span>
        <span class="score-pts">${row.points}</span>
      </li>`
      )
      .join("");
  }

  private renderMembers() {
    const list = this.root.querySelector("#member-list");
    if (!list) return;
    list.innerHTML = "";
    this.room.state.members.forEach((member, sessionId) => {
      const li = document.createElement("li");
      li.className = "member-row" + (sessionId === this.room.sessionId ? " member-row--me" : "");
      const host = sessionId === this.room.state.hostSessionId;
      const avatar = member.avatarUrl
        ? `<img class="member-avatar" src="${this.escapeAttr(member.avatarUrl)}" alt="" />`
        : `<span class="member-avatar member-avatar--fallback">${this.escapeHtml(member.username.charAt(0).toUpperCase())}</span>`;
      li.innerHTML = `
        ${avatar}
        <span class="member-name">${this.escapeHtml(member.username)}${sessionId === this.room.sessionId ? " (you)" : ""}</span>
        ${host ? '<span class="host-badge">Host</span>' : ""}`;
      list.appendChild(li);
    });
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
    if (this.tickTimer) clearInterval(this.tickTimer);
  }
}
