import assert from "node:assert/strict";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { JWT } from "@colyseus/auth";
import appConfig from "../src/app.config";

const TEST_CHANNEL = "123456789012345678";

async function connectAs(
  colyseus: ColyseusTestServer,
  room: unknown,
  username: string,
  channelId = TEST_CHANNEL
) {
  const token = await JWT.sign({ id: `user_${username}`, username });
  colyseus.sdk.auth.token = token;
  return colyseus.connectTo(room, { channelId });
}

describe("GameRoom", () => {
  let colyseus: ColyseusTestServer;

  before(async () => {
    colyseus = await boot(appConfig);
  });

  after(async () => {
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("assigns X and O and allows alternating moves", async () => {
    const room = await colyseus.createRoom("my_room", { channelId: TEST_CHANNEL });

    const x = await connectAs(colyseus, room, "Alice");
    const o = await connectAs(colyseus, room, "Bob");

    await room.waitForNextPatch();
    assert.equal(room.state.phase, "playing");
    assert.equal(room.state.playerXSessionId, x.sessionId);
    assert.equal(room.state.playerOSessionId, o.sessionId);
    assert.equal(room.state.currentTurnSessionId, x.sessionId);

    x.send("placeMark", { index: 0 });
    await room.waitForNextPatch();
    assert.equal(room.state.board[0], "X");
    assert.equal(room.state.currentTurnSessionId, o.sessionId);

    o.send("placeMark", { index: 1 });
    await room.waitForNextPatch();
    assert.equal(room.state.board[1], "O");

    x.send("placeMark", { index: 3 });
    await room.waitForNextPatch();
    o.send("placeMark", { index: 4 });
    await room.waitForNextPatch();
    x.send("placeMark", { index: 6 });
    await room.waitForNextPatch();

    assert.equal(room.state.phase, "finished");
    assert.equal(room.state.winner, "X");

    await x.leave();
    await o.leave();
  });

  it("detects a draw", async () => {
    const room = await colyseus.createRoom("my_room", { channelId: TEST_CHANNEL });

    const x = await connectAs(colyseus, room, "Cx");
    const o = await connectAs(colyseus, room, "Co");
    await room.waitForNextPatch();

    const moves = [4, 0, 2, 6, 1, 7, 3, 5, 8];
    let turnX = true;
    for (const index of moves) {
      if (turnX) {
        x.send("placeMark", { index });
      } else {
        o.send("placeMark", { index });
      }
      await room.waitForNextPatch();
      turnX = !turnX;
    }

    assert.equal(room.state.winner, "draw");
    await x.leave();
    await o.leave();
  });
});
