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
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const client = await connectAs(colyseus, room, "alice");

    await room.waitForNextPatch();
    assert.strictEqual(room.state.hostSessionId, client.sessionId);
    assert.strictEqual(room.state.members.size, 1);
  });

  it("rejects invalid channelId on join", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
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

  it("only host can load video when queue editing is restricted", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    const viewer = await connectAs(colyseus, room, "viewer");
    await room.waitForNextPatch();

    host.send("setPermissions", { allowEveryoneQueue: false });
    await room.waitForNextPatch();

    viewer.send("loadVideo", { videoId: "dQw4w9WgXcQ", title: "Test" });
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.videoId, "");

    host.send("loadVideo", { videoId: "dQw4w9WgXcQ", title: "Test" });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.videoId, "dQw4w9WgXcQ");
  });

  it("transfers host when host leaves", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
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

  it("transfers host when current host picks another viewer", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    const viewer = await connectAs(colyseus, room, "viewer");
    await room.waitForNextPatch();

    host.send("transferHost", { sessionId: viewer.sessionId });
    await room.waitForNextPatch();

    assert.strictEqual(room.state.hostSessionId, viewer.sessionId);
  });

  it("batch adds valid videos to queue", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
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

  it("keeps played items in queue when advancing", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    await room.waitForNextPatch();

    host.send("loadVideo", {
      videoId: "dQw4w9WgXcQ",
      title: "First",
      durationSec: 120,
      autoPlay: true,
    });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));

    host.send("addToQueue", { videoId: "9bZkp7q19f0", title: "Second", durationSec: 200 });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.queue.length, 2);
    assert.strictEqual(room.state.queue[0].status, "playing");

    host.send("videoEnded", {});
    await room.waitForNextPatch();

    assert.strictEqual(room.state.queue.length, 2);
    assert.strictEqual(room.state.queue[0].status, "played");
    assert.strictEqual(room.state.queue[1].status, "playing");
    assert.strictEqual(room.state.videoId, "9bZkp7q19f0");
    assert.strictEqual(room.state.isPlaying, true);
  });

  it("autostarts new video when added after playlist ended", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    await room.waitForNextPatch();

    host.send("addToQueue", { videoId: "dQw4w9WgXcQ", title: "Only", durationSec: 120 });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.queue[0].status, "playing");

    host.send("videoEnded", {});
    await room.waitForNextPatch();
    assert.strictEqual(room.state.queue[0].status, "played");
    assert.strictEqual(room.state.isPlaying, false);

    await new Promise((r) => setTimeout(r, 150));

    host.send("addToQueue", { videoId: "9bZkp7q19f0", title: "After end", durationSec: 200 });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));

    assert.strictEqual(room.state.queue.length, 2);
    assert.strictEqual(room.state.queue[1].status, "playing");
    assert.strictEqual(room.state.videoId, "9bZkp7q19f0");
    assert.strictEqual(room.state.isPlaying, true);
  });

  it("allows queue edits when allowEveryoneQueue is enabled", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    const viewer = await connectAs(colyseus, room, "viewer");
    await room.waitForNextPatch();

    host.send("setPermissions", { allowEveryoneQueue: true });
    await room.waitForNextPatch();

    viewer.send("addToQueue", { videoId: "dQw4w9WgXcQ", title: "Viewer pick" });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.queue.length, 1);
    assert.strictEqual(room.state.queue[0].title, "Viewer pick");
  });

  it("reorders queued items", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    await room.waitForNextPatch();

    host.send("addBatchToQueue", {
      items: [
        { videoId: "dQw4w9WgXcQ", title: "One" },
        { videoId: "9bZkp7q19f0", title: "Two" },
        { videoId: "jNQXAC9IVRw", title: "Three" },
      ],
    });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.queue.length, 3);

    host.send("moveQueueItem", { fromIndex: 2, toIndex: 1 });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.queue[0].status, "playing");
    assert.strictEqual(room.state.queue[1].title, "Three");
    assert.strictEqual(room.state.queue[2].title, "Two");
  });

  it("plays a specific queue item when selected", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    await room.waitForNextPatch();

    host.send("addBatchToQueue", {
      items: [
        { videoId: "dQw4w9WgXcQ", title: "One", durationSec: 120 },
        { videoId: "9bZkp7q19f0", title: "Two", durationSec: 200 },
        { videoId: "jNQXAC9IVRw", title: "Three", durationSec: 180 },
      ],
    });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.queue[0].status, "playing");
    assert.strictEqual(room.state.videoId, "dQw4w9WgXcQ");

    host.send("playQueueItem", { index: 2 });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));

    assert.strictEqual(room.state.queue[0].status, "played");
    assert.strictEqual(room.state.queue[2].status, "playing");
    assert.strictEqual(room.state.videoId, "jNQXAC9IVRw");
    assert.strictEqual(room.state.isPlaying, true);
  });

  it("skips to next queue item when video is unavailable", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    await room.waitForNextPatch();

    host.send("addBatchToQueue", {
      items: [
        { videoId: "dQw4w9WgXcQ", title: "First", durationSec: 120 },
        { videoId: "9bZkp7q19f0", title: "Second", durationSec: 200 },
      ],
    });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.queue[0].status, "playing");

    host.send("videoUnavailable", { errorCode: 150 });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));

    assert.strictEqual(room.state.queue[0].status, "unavailable");
    assert.strictEqual(room.state.queue[1].status, "playing");
    assert.strictEqual(room.state.videoId, "9bZkp7q19f0");
    assert.strictEqual(room.state.isPlaying, true);
  });

  it("continues from next song after jumping ahead in the playlist", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    await room.waitForNextPatch();

    host.send("addBatchToQueue", {
      items: [
        { videoId: "dQw4w9WgXcQ", title: "One", durationSec: 120 },
        { videoId: "9bZkp7q19f0", title: "Two", durationSec: 200 },
        { videoId: "jNQXAC9IVRw", title: "Three", durationSec: 180 },
        { videoId: "kJQP7kiw5Fk", title: "Four", durationSec: 150 },
      ],
    });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));

    host.send("playQueueItem", { index: 2 });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.queue[2].status, "playing");

    host.send("videoEnded", {});
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));

    assert.strictEqual(room.state.queue[1].status, "queued");
    assert.strictEqual(room.state.queue[2].status, "played");
    assert.strictEqual(room.state.queue[3].status, "playing");
    assert.strictEqual(room.state.videoId, "kJQP7kiw5Fk");
  });

  it("plays skipped songs first when continue-from-position is off", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    await room.waitForNextPatch();

    host.send("setPermissions", { continueFromPosition: false });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.continueFromPosition, false);
    await new Promise((r) => setTimeout(r, 150));

    host.send("addBatchToQueue", {
      items: [
        { videoId: "dQw4w9WgXcQ", title: "One", durationSec: 120 },
        { videoId: "9bZkp7q19f0", title: "Two", durationSec: 200 },
        { videoId: "jNQXAC9IVRw", title: "Three", durationSec: 180 },
      ],
    });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.queue.length, 3);

    host.send("playQueueItem", { index: 2 });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.queue[2].status, "playing");

    host.send("videoEnded", {});
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));

    assert.strictEqual(room.state.queue[1].status, "playing");
    assert.strictEqual(room.state.videoId, "9bZkp7q19f0");
  });

  it("replays a played queue item", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    await room.waitForNextPatch();

    host.send("addBatchToQueue", {
      items: [
        { videoId: "dQw4w9WgXcQ", title: "First", durationSec: 120 },
        { videoId: "9bZkp7q19f0", title: "Second", durationSec: 200 },
      ],
    });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));

    host.send("videoEnded", {});
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.queue[0].status, "played");
    assert.strictEqual(room.state.queue[1].status, "playing");

    host.send("playQueueItem", { index: 0 });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));

    assert.strictEqual(room.state.queue[0].status, "playing");
    assert.strictEqual(room.state.queue[1].status, "played");
    assert.strictEqual(room.state.videoId, "dQw4w9WgXcQ");
    assert.strictEqual(room.state.isPlaying, true);
  });

  it("reorders played items", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    await room.waitForNextPatch();

    host.send("addBatchToQueue", {
      items: [
        { videoId: "dQw4w9WgXcQ", title: "One", durationSec: 120 },
        { videoId: "9bZkp7q19f0", title: "Two", durationSec: 200 },
        { videoId: "jNQXAC9IVRw", title: "Three", durationSec: 180 },
      ],
    });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));

    host.send("videoEnded", {});
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.queue[0].status, "played");
    assert.strictEqual(room.state.queue[1].status, "playing");

    host.send("moveQueueItem", { fromIndex: 0, toIndex: 2 });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 150));

    assert.strictEqual(room.state.queue[0].status, "playing");
    assert.strictEqual(room.state.queue[0].title, "Two");
    assert.strictEqual(room.state.queue[1].status, "played");
    assert.strictEqual(room.state.queue[1].title, "One");
    assert.strictEqual(room.state.queue[2].status, "queued");
    assert.strictEqual(room.state.queue[2].title, "Three");
  });

  it("rejects invalid video IDs", async () => {
    const room = await colyseus.createRoom<WatchRoomState>("my_room", {
      channelId: TEST_CHANNEL,
    });
    const host = await connectAs(colyseus, room, "host");
    await room.waitForNextPatch();

    host.send("loadVideo", { videoId: "<script>alert(1)</script>", title: "XSS" });
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(room.state.videoId, "");
  });
});
