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

describe("UnoRoom", () => {
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

  it("starts classic game when host starts with 2 players", async () => {
    const room = await colyseus.createRoom("my_room", { channelId: TEST_CHANNEL });
    const host = await connectAs(colyseus, room, "Host");
    await connectAs(colyseus, room, "Guest");
    await room.waitForNextPatch();

    host.send("startGame", { mode: "classic" });
    await room.waitForNextPatch();

    assert.equal(room.state.phase, "playing");
    assert.equal(room.state.gameMode, "classic");
    assert.ok(room.state.topCard.value);
    assert.equal(room.state.handCounts.get(host.sessionId), 7);

    await host.leave();
  });

  it("starts no mercy mode", async () => {
    const room = await colyseus.createRoom("my_room", { channelId: TEST_CHANNEL });
    const host = await connectAs(colyseus, room, "Host");
    await connectAs(colyseus, room, "Guest");
    await room.waitForNextPatch();

    host.send("startGame", { mode: "noMercy" });
    await room.waitForNextPatch();

    assert.equal(room.state.phase, "playing");
    assert.equal(room.state.gameMode, "noMercy");

    await host.leave();
  });

  it("sends private hand on join", async () => {
    const room = await colyseus.createRoom("my_room", { channelId: TEST_CHANNEL });
    const host = await connectAs(colyseus, room, "Host");
    await connectAs(colyseus, room, "Guest");
    await room.waitForNextPatch();

    const handPromise = new Promise<{ cards: { id: string }[] }>((resolve) => {
      host.onMessage("handUpdate", resolve);
    });

    host.send("startGame", { mode: "classic" });
    await room.waitForNextPatch();

    const hand = await handPromise;
    assert.equal(hand.cards.length, 7);

    await host.leave();
  });

  it("only host can start the game", async () => {
    const room = await colyseus.createRoom("my_room", { channelId: TEST_CHANNEL });
    await connectAs(colyseus, room, "Host");
    const guest = await connectAs(colyseus, room, "Guest");
    await room.waitForNextPatch();

    guest.send("startGame", { mode: "classic" });
    await room.waitForNextPatch();

    assert.equal(room.state.phase, "lobby");
  });
});
