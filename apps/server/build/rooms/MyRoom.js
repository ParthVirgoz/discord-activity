"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Member = exports.QueueItem = exports.MyRoomState = exports.MyRoom = void 0;
/**
 * Kept for Railway/production compatibility — the live server registers "my_room".
 * Re-exports Watch Together room logic under the legacy class name.
 */
var WatchRoom_1 = require("./WatchRoom");
Object.defineProperty(exports, "MyRoom", { enumerable: true, get: function () { return WatchRoom_1.WatchRoom; } });
Object.defineProperty(exports, "MyRoomState", { enumerable: true, get: function () { return WatchRoom_1.WatchRoomState; } });
Object.defineProperty(exports, "QueueItem", { enumerable: true, get: function () { return WatchRoom_1.QueueItem; } });
Object.defineProperty(exports, "Member", { enumerable: true, get: function () { return WatchRoom_1.Member; } });
