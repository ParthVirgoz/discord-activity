import { JWT } from "@colyseus/auth";
import { Room, Client, CloseCode } from "colyseus";
import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import { isValidChannelId, sanitizeUsername } from "../utils/validation";
import {
  BLUFF_PROMPTS,
  DECOY_ANSWERS,
  MIN_PLAYERS,
  MAX_ROUNDS,
  SUBMIT_SECONDS,
  VOTE_SECONDS,
  REVEAL_SECONDS,
} from "./bluffPrompts";

export type GamePhase = "lobby" | "submit" | "vote" | "reveal" | "ended";

export class Member extends Schema {
  @type("string") username = "";
  @type("string") avatarUrl = "";
  @type("string") discordId = "";
}

export class VoteOption extends Schema {
  @type("string") id = "";
  @type("string") text = "";
}

export class PlayerScore extends Schema {
  @type("number") points = 0;
}

export class GameRoomState extends Schema {
  @type({ map: Member }) members = new MapSchema<Member>();
  @type("string") phase: GamePhase = "lobby";
  @type("string") hostSessionId = "";
  @type("number") round = 0;
  @type("number") maxRounds = MAX_ROUNDS;
  @type("string") prompt = "";
  @type({ array: VoteOption }) options = new ArraySchema<VoteOption>();
  @type({ map: PlayerScore }) scores = new MapSchema<PlayerScore>();
  @type("number") submittedCount = 0;
  @type("number") votedCount = 0;
  @type("number") phaseEndsAt = 0;
  @type("string") channelId = "";
  @type("string") truthOptionId = "";
}

function sanitizeAnswer(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, 72);
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export class GameRoom extends Room {
  state = new GameRoomState();
  maxClients = 12;

  private channelId = "";
  private joinedAt = new Map<string, number>();
  private realAnswer = "";
  private submissions = new Map<string, string>();
  private votes = new Map<string, string>();
  private optionAuthors = new Map<string, string>();
  private usedPrompts = new Set<number>();
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private optionCounter = 0;

  static onAuth(token: string) {
    return JWT.verify(token);
  }

  onCreate(options: { channelId?: string }) {
    if (!isValidChannelId(options?.channelId)) {
      throw new Error("Invalid channelId");
    }
    this.channelId = options.channelId!;
    this.state.channelId = this.channelId;
    this.autoDispose = false;

    this.onMessage("startGame", (client) => this.handleStartGame(client));
    this.onMessage("submitAnswer", (client, msg: { text?: string }) => {
      this.handleSubmitAnswer(client, msg?.text);
    });
    this.onMessage("vote", (client, msg: { optionId?: string }) => {
      this.handleVote(client, msg?.optionId);
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

    const staleSessions: string[] = [];
    this.state.members.forEach((member, sessionId) => {
      if (member.discordId === discordId && sessionId !== client.sessionId) {
        staleSessions.push(sessionId);
      }
    });
    for (const sessionId of staleSessions) {
      this.removePlayer(sessionId);
    }

    const member = new Member();
    member.username = username;
    member.discordId = discordId;
    member.avatarUrl = avatarHash
      ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`
      : "";

    this.state.members.set(client.sessionId, member);
    this.joinedAt.set(client.sessionId, Date.now());

    if (!this.state.hostSessionId || !this.state.members.has(this.state.hostSessionId)) {
      this.state.hostSessionId = client.sessionId;
    }

    if (!this.state.scores.has(client.sessionId)) {
      const score = new PlayerScore();
      score.points = 0;
      this.state.scores.set(client.sessionId, score);
    }

    client.send("roomJoined", { sessionId: client.sessionId, isHost: this.isHost(client) });
  }

  async onLeave(client: Client, code: number) {
    if (code !== CloseCode.CONSENTED) {
      try {
        await this.allowReconnection(client, 120);
        client.send("reconnected", { sessionId: client.sessionId, isHost: this.isHost(client) });
        return;
      } catch {
        /* disconnected */
      }
    }

    this.removePlayer(client.sessionId);

    if (this.state.members.size === 0) {
      this.clearPhaseTimer();
      this.disconnect();
      return;
    }

    if (this.state.hostSessionId === client.sessionId) {
      this.state.hostSessionId = this.orderedSessions()[0] ?? "";
    }

    if (this.state.phase !== "lobby" && this.state.members.size < MIN_PLAYERS) {
      this.endToLobby("Not enough players — back to lobby.");
    } else if (this.state.phase === "submit") {
      this.tryAdvanceFromSubmit();
    } else if (this.state.phase === "vote") {
      this.tryAdvanceFromVote();
    }
  }

  private removePlayer(sessionId: string) {
    this.state.members.delete(sessionId);
    this.joinedAt.delete(sessionId);
    this.submissions.delete(sessionId);
    this.votes.delete(sessionId);
    this.state.scores.delete(sessionId);
  }

  private isHost(client: Client): boolean {
    return this.state.hostSessionId === client.sessionId;
  }

  private orderedSessions(): string[] {
    return [...this.joinedAt.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id)
      .filter((id) => this.state.members.has(id));
  }

  private handleStartGame(client: Client) {
    if (!this.isHost(client)) return;
    if (this.state.phase !== "lobby" && this.state.phase !== "ended") return;
    if (this.state.members.size < MIN_PLAYERS) return;

    this.usedPrompts.clear();
    this.state.round = 0;
    this.state.scores.forEach((s) => {
      s.points = 0;
    });
    this.startRound();
  }

  private handlePlayAgain(client: Client) {
    if (!this.isHost(client)) return;
    if (this.state.phase !== "ended") return;
    this.state.phase = "lobby";
    this.state.prompt = "";
    this.state.truthOptionId = "";
    this.clearOptions();
    this.broadcast("backToLobby", {});
  }

  private startRound() {
    this.clearPhaseTimer();
    this.submissions.clear();
    this.votes.clear();
    this.optionAuthors.clear();
    this.clearOptions();
    this.state.truthOptionId = "";
    this.state.submittedCount = 0;
    this.state.votedCount = 0;

    this.state.round += 1;
    if (this.state.round > this.state.maxRounds) {
      this.state.phase = "ended";
      this.state.phaseEndsAt = 0;
      this.broadcast("gameEnded", { scores: this.buildScoreboard() });
      return;
    }

    const promptIndex = this.pickPromptIndex();
    const entry = BLUFF_PROMPTS[promptIndex];
    this.realAnswer = entry.answer;
    this.state.prompt = entry.prompt;
    this.state.phase = "submit";
    this.state.phaseEndsAt = Date.now() + SUBMIT_SECONDS * 1000;

    this.phaseTimer = setTimeout(() => this.beginVoting(), SUBMIT_SECONDS * 1000);
    this.broadcast("roundStarted", { round: this.state.round });
  }

  private pickPromptIndex(): number {
    const available = BLUFF_PROMPTS.map((_, i) => i).filter((i) => !this.usedPrompts.has(i));
    const pool = available.length > 0 ? available : BLUFF_PROMPTS.map((_, i) => i);
    if (available.length === 0) this.usedPrompts.clear();
    const index = pool[Math.floor(Math.random() * pool.length)];
    this.usedPrompts.add(index);
    return index;
  }

  private handleSubmitAnswer(client: Client, text?: unknown) {
    if (this.state.phase !== "submit") return;
    if (!this.state.members.has(client.sessionId)) return;
    if (this.submissions.has(client.sessionId)) return;

    const answer = sanitizeAnswer(text);
    if (answer.length < 2) return;
    if (answer.toLowerCase() === this.realAnswer.toLowerCase()) return;

    this.submissions.set(client.sessionId, answer);
    this.state.submittedCount = this.submissions.size;
    this.tryAdvanceFromSubmit();
  }

  private tryAdvanceFromSubmit() {
    if (this.state.phase !== "submit") return;
    const active = this.orderedSessions();
    if (this.submissions.size >= active.length && active.length >= MIN_PLAYERS) {
      this.beginVoting();
    }
  }

  private beginVoting() {
    if (this.state.phase !== "submit") return;
    this.clearPhaseTimer();

    const entries: { id: string; text: string; author: string }[] = [];
    const addEntry = (text: string, author: string) => {
      const id = `opt_${++this.optionCounter}`;
      entries.push({ id, text, author });
      return id;
    };

    addEntry(this.realAnswer, "__truth__");

    for (const [sessionId, text] of this.submissions) {
      if (!this.state.members.has(sessionId)) continue;
      addEntry(text, sessionId);
    }

    const decoys = shuffle(DECOY_ANSWERS);
    while (entries.length < Math.max(4, this.state.members.size + 1) && decoys.length > 0) {
      const decoy = decoys.pop()!;
      if (entries.some((e) => e.text.toLowerCase() === decoy.toLowerCase())) continue;
      addEntry(decoy, "__decoy__");
    }

    const shuffled = shuffle(entries);
    this.clearOptions();
    for (const entry of shuffled) {
      const opt = new VoteOption();
      opt.id = entry.id;
      opt.text = entry.text;
      this.state.options.push(opt);
      this.optionAuthors.set(entry.id, entry.author);
      if (entry.author === "__truth__") {
        this.state.truthOptionId = entry.id;
      }
    }

    this.state.phase = "vote";
    this.state.votedCount = 0;
    this.state.phaseEndsAt = Date.now() + VOTE_SECONDS * 1000;
    this.phaseTimer = setTimeout(() => this.revealRound(), VOTE_SECONDS * 1000);
  }

  private handleVote(client: Client, optionId?: string) {
    if (this.state.phase !== "vote") return;
    if (!this.state.members.has(client.sessionId)) return;
    if (typeof optionId !== "string" || !this.optionAuthors.has(optionId)) return;
    if (this.votes.has(client.sessionId)) return;

    const author = this.optionAuthors.get(optionId);
    if (author === client.sessionId) return;

    this.votes.set(client.sessionId, optionId);
    this.state.votedCount = this.votes.size;
    this.tryAdvanceFromVote();
  }

  private tryAdvanceFromVote() {
    if (this.state.phase !== "vote") return;
    const active = this.orderedSessions();
    if (this.votes.size >= active.length && active.length >= MIN_PLAYERS) {
      this.revealRound();
    }
  }

  private revealRound() {
    if (this.state.phase !== "vote") return;
    this.clearPhaseTimer();
    this.state.phase = "reveal";

    const roundGains = new Map<string, number>();
    for (const sessionId of this.orderedSessions()) {
      roundGains.set(sessionId, 0);
    }

    const voteCounts = new Map<string, number>();
    for (const optionId of this.votes.values()) {
      voteCounts.set(optionId, (voteCounts.get(optionId) ?? 0) + 1);
    }

    for (const [voterId, optionId] of this.votes) {
      const author = this.optionAuthors.get(optionId);
      if (optionId === this.state.truthOptionId) {
        roundGains.set(voterId, (roundGains.get(voterId) ?? 0) + 2);
      } else if (author && author !== "__truth__" && author !== "__decoy__") {
        roundGains.set(author, (roundGains.get(author) ?? 0) + 1);
      }
    }

    for (const [sessionId, gain] of roundGains) {
      const score = this.state.scores.get(sessionId);
      if (score) score.points += gain;
    }

    const revealOptions = this.state.options.map((opt) => ({
      id: opt.id,
      text: opt.text,
      isTruth: opt.id === this.state.truthOptionId,
      authorSessionId:
        this.optionAuthors.get(opt.id) === "__truth__" || this.optionAuthors.get(opt.id) === "__decoy__"
          ? null
          : this.optionAuthors.get(opt.id) ?? null,
      votes: voteCounts.get(opt.id) ?? 0,
    }));

    this.broadcast("roundReveal", {
      truthOptionId: this.state.truthOptionId,
      realAnswer: this.realAnswer,
      options: revealOptions,
      roundGains: Object.fromEntries(roundGains),
      scores: this.buildScoreboard(),
    });

    this.state.phaseEndsAt = Date.now() + REVEAL_SECONDS * 1000;
    this.phaseTimer = setTimeout(() => {
      if (this.state.round >= this.state.maxRounds) {
        this.state.phase = "ended";
        this.broadcast("gameEnded", { scores: this.buildScoreboard() });
      } else {
        this.startRound();
      }
    }, REVEAL_SECONDS * 1000);
  }

  private buildScoreboard(): { sessionId: string; username: string; points: number }[] {
    return this.orderedSessions()
      .map((sessionId) => ({
        sessionId,
        username: this.state.members.get(sessionId)?.username ?? "Player",
        points: this.state.scores.get(sessionId)?.points ?? 0,
      }))
      .sort((a, b) => b.points - a.points);
  }

  private endToLobby(message: string) {
    this.clearPhaseTimer();
    this.state.phase = "lobby";
    this.state.round = 0;
    this.state.prompt = "";
    this.state.truthOptionId = "";
    this.clearOptions();
    this.submissions.clear();
    this.votes.clear();
    this.broadcast("backToLobby", { message });
  }

  private clearOptions() {
    this.state.options.clear();
  }

  private clearPhaseTimer() {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }

  onDispose() {
    this.clearPhaseTimer();
  }
}
