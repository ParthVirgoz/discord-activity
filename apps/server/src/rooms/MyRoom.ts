/**
 * Kept for Railway/production compatibility — the live server registers "my_room".
 * Re-exports Watch Together room logic under the legacy class name.
 */
export {
  WatchRoom as MyRoom,
  WatchRoomState as MyRoomState,
  QueueItem,
  Member,
} from "./WatchRoom";
