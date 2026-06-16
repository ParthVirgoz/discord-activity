import { JWT } from "@colyseus/auth";
import { Room, Client, CloseCode } from "colyseus";
import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import { isValidChannelId, sanitizeUsername } from "../utils/validation";

export type GamePhase = "waiting" | "playing" | "finished";

export class Member extends Schema {
  @type("string") username = "";
  @type("string") avatarUrl = "";
  @type("string") discordId = "";
}

export class GameRoomState extends Schema {
  @type({ map: Member }) members = new MapSchema<Member>();
  @type(["string"]) board = new ArraySchema<string>();
  @type("string") phase: GamePhase = "waiting";
  @type("string") currentTurnSessionId = "";
  @type("string") playerXSessionId = "";
  @type("string") playerOSessionId = "";
  /** "", "X", "O", or "draw" */
  @type("string") winner = "";
  @type("string") channelId = "";
}

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export class GameRoom extends Room {
  state = new GameRoomState();
  maxClients = 25;

  private channelId = "";
  private joinedAt = new Map<string, number>();

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
    this.resetBoard();

    this.onMessage("placeMark", (client, msg: { index?: number }) => {
      this.handlePlaceMark(client, msg?.index);
    });

    this.onMessage("rematch", (client) => {
      this.handleRematch(client);
    });

    this.onMessage("leaveSeat", (client) => {
      this.handleLeaveSeat(client);
    });
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
      this.state.members.delete(sessionId);
      this.joinedAt.delete(sessionId);
    }

    const member = new Member();
    member.username = username;
    member.discordId = discordId;
    member.avatarUrl = avatarHash
      ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`
      : "";

    this.state.members.set(client.sessionId, member);
    this.joinedAt.set(client.sessionId, Date.now());

    this.syncPlayerSeats();
    client.send("roomJoined", this.buildSnapshot(client.sessionId));
  }

  async onLeave(client: Client, code: number) {
    const sessionId = client.sessionId;

    if (code !== CloseCode.CONSENTED) {
      try {
        await this.allowReconnection(client, 120);
        client.send("reconnected", this.buildSnapshot(client.sessionId));
        return;
      } catch {
        /* disconnected */
      }
    }

    this.state.members.delete(sessionId);
    this.joinedAt.delete(sessionId);

    if (sessionId === this.state.playerXSessionId) {
      this.state.playerXSessionId = "";
    }
    if (sessionId === this.state.playerOSessionId) {
      this.state.playerOSessionId = "";
    }

    this.syncPlayerSeats();

    if (this.state.members.size === 0) {
      this.disconnect();
    }
  }

  private buildSnapshot(forSessionId: string) {
    return {
      sessionId: forSessionId,
      symbol: this.symbolFor(forSessionId),
      phase: this.state.phase,
      winner: this.state.winner,
    };
  }

  private symbolFor(sessionId: string): "" | "X" | "O" {
    if (sessionId === this.state.playerXSessionId) return "X";
    if (sessionId === this.state.playerOSessionId) return "O";
    return "";
  }

  private orderedSessions(): string[] {
    return [...this.joinedAt.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([sessionId]) => sessionId)
      .filter((sessionId) => this.state.members.has(sessionId));
  }

  private syncPlayerSeats() {
    const sessions = this.orderedSessions();

    if (this.state.playerXSessionId && !this.state.members.has(this.state.playerXSessionId)) {
      this.state.playerXSessionId = "";
    }
    if (this.state.playerOSessionId && !this.state.members.has(this.state.playerOSessionId)) {
      this.state.playerOSessionId = "";
    }

    if (!this.state.playerXSessionId && sessions[0]) {
      this.state.playerXSessionId = sessions[0];
    }
    if (!this.state.playerOSessionId) {
      const oSession = sessions.find((s) => s !== this.state.playerXSessionId);
      if (oSession) this.state.playerOSessionId = oSession;
    }

    if (this.state.playerXSessionId && this.state.playerOSessionId) {
      if (this.state.phase === "waiting") {
        this.startNewRound();
      }
    } else {
      this.state.phase = "waiting";
      this.state.winner = "";
      this.state.currentTurnSessionId = "";
      this.resetBoard();
    }
  }

  private startNewRound() {
    this.resetBoard();
    this.state.phase = "playing";
    this.state.winner = "";
    this.state.currentTurnSessionId = this.state.playerXSessionId;
  }

  private resetBoard() {
    this.state.board.clear();
    for (let i = 0; i < 9; i++) {
      this.state.board.push("");
    }
  }

  private handlePlaceMark(client: Client, index?: number) {
    if (this.state.phase !== "playing") return;
    if (client.sessionId !== this.state.currentTurnSessionId) return;
    if (typeof index !== "number" || index < 0 || index > 8) return;
    if (this.state.board[index]) return;

    const symbol = this.symbolFor(client.sessionId);
    if (symbol !== "X" && symbol !== "O") return;

    this.state.board[index] = symbol;

    const winSymbol = this.checkWinner();
    if (winSymbol) {
      this.state.phase = "finished";
      this.state.winner = winSymbol;
      this.state.currentTurnSessionId = "";
      this.broadcast("gameOver", { winner: winSymbol });
      return;
    }

    if (this.state.board.every((cell) => cell !== "")) {
      this.state.phase = "finished";
      this.state.winner = "draw";
      this.state.currentTurnSessionId = "";
      this.broadcast("gameOver", { winner: "draw" });
      return;
    }

    this.state.currentTurnSessionId =
      client.sessionId === this.state.playerXSessionId
        ? this.state.playerOSessionId
        : this.state.playerXSessionId;
  }

  private checkWinner(): "" | "X" | "O" {
    for (const [a, b, c] of WIN_LINES) {
      const v = this.state.board[a];
      if (v && v === this.state.board[b] && v === this.state.board[c]) {
        return v as "X" | "O";
      }
    }
    return "";
  }

  private handleRematch(client: Client) {
    const symbol = this.symbolFor(client.sessionId);
    if (!symbol) return;
    if (this.state.phase !== "finished") return;
    if (!this.state.playerXSessionId || !this.state.playerOSessionId) return;
    this.startNewRound();
    this.broadcast("rematch", { from: client.sessionId });
  }

  private handleLeaveSeat(client: Client) {
    if (client.sessionId === this.state.playerXSessionId) {
      this.state.playerXSessionId = "";
    } else if (client.sessionId === this.state.playerOSessionId) {
      this.state.playerOSessionId = "";
    } else {
      return;
    }
    this.state.phase = "waiting";
    this.state.winner = "";
    this.state.currentTurnSessionId = "";
    this.resetBoard();
    this.syncPlayerSeats();
  }
}
