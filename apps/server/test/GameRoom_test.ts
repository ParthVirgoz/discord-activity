import assert from "node:assert/strict";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { JWT } from "@colyseus/auth";
import appConfig from "../src/app.config";

const TEST_CHANNEL = "123456789012345678";

async function connectAs(
  colyseus: ColyseusTestServer,
  room: unknown,
  username: string
) {
  const token = await JWT.sign({ id: `user_${username}`, username });
  colyseus.sdk.auth.token = token;
  return colyseus.connectTo(room, { channelId: TEST_CHANNEL });
}

describe("GameRoom (Bluff Party)", () => {
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

  it("starts a round when host starts with 3 players", async () => {
    const room = await colyseus.createRoom("my_room", { channelId: TEST_CHANNEL });
    const host = await connectAs(colyseus, room, "Host");
    await connectAs(colyseus, room, "B");
    await connectAs(colyseus, room, "C");
    await room.waitForNextPatch();

    host.send("startGame");
    await room.waitForNextPatch();

    assert.equal(room.state.phase, "submit");
    assert.equal(room.state.round, 1);
    assert.ok(room.state.prompt.length > 0);

    await host.leave();
  });

  it("moves to vote after all players submit", async () => {
    const room = await colyseus.createRoom("my_room", { channelId: TEST_CHANNEL });
    const a = await connectAs(colyseus, room, "A");
    const b = await connectAs(colyseus, room, "B");
    const c = await connectAs(colyseus, room, "C");
    await room.waitForNextPatch();

    a.send("startGame");
    await room.waitForNextPatch();

    a.send("submitAnswer", { text: "A wild guess" });
    b.send("submitAnswer", { text: "Another lie" });
    c.send("submitAnswer", { text: "Something silly" });
    await room.waitForNextPatch();

    assert.equal(room.state.phase, "vote");
    assert.ok(room.state.options.length >= 4);

    await a.leave();
    await b.leave();
    await c.leave();
  });
});
