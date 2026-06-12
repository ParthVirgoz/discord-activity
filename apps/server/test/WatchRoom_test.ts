import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { JWT } from "@colyseus/auth";
import appConfig from "../src/app.config";
import { WatchRoomState } from "../src/rooms/WatchRoom";

const TEST_CHANNEL = "123456789012345678";

async function connectAs(colyseus: ColyseusTestServer, room: any, username: string) {
  const token = await JWT.sign({ id: `user_${username}`, username });
  colyseus.sdk.auth.token = token;
  return colyseus.connectTo(room, { channelId: TEST_CHANNEL });
}

describe("WatchRoom", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());
  beforeEach(async () => colyseus.cleanup());

  it("creates room and assigns first joiner as host", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("watch_room", {
      channelId: TEST_CHANNEL,
    });
    const client = await connectAs(colyseus, room, "alice");

    await room.waitForNextPatch();
    assert.strictEqual(room.state.hostSessionId, client.sessionId);
    assert.strictEqual(room.state.members.size, 1);
  });

  it("rejects invalid channelId on join", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("watch_room", {
      channelId: TEST_CHANNEL,
    });

    try {
      const token = await JWT.sign({ id: "bad", username: "bad" });
      colyseus.sdk.auth.token = token;
      await colyseus.connectTo(room, { channelId: "not-a-snowflake" });
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e);
    }
  });

  it("only host can load video", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("watch_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    const viewer = await connectAs(colyseus, room, "viewer");
    await room.waitForNextPatch();

    viewer.send("loadVideo", { videoId: "dQw4w9WgXcQ", title: "Test" });
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.videoId, "");

    host.send("loadVideo", { videoId: "dQw4w9WgXcQ", title: "Test" });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.videoId, "dQw4w9WgXcQ");
  });

  it("transfers host when host leaves", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("watch_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    const viewer = await connectAs(colyseus, room, "viewer");
    await room.waitForNextPatch();

    assert.strictEqual(room.state.hostSessionId, host.sessionId);
    await host.leave();
    await room.waitForNextPatch();
    assert.strictEqual(room.state.hostSessionId, viewer.sessionId);
  });

  it("batch adds valid videos to queue", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("watch_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    await room.waitForNextPatch();

    host.send("addBatchToQueue", {
      items: [
        { videoId: "dQw4w9WgXcQ", title: "One" },
        { videoId: "invalid", title: "Bad" },
        { videoId: "9bZkp7q19f0", title: "Two" },
      ],
    });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.queue.length, 2);
  });

  it("rejects invalid video IDs", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("watch_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    await room.waitForNextPatch();

    host.send("loadVideo", { videoId: "<script>alert(1)</script>", title: "XSS" });
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.videoId, "");
  });
});
