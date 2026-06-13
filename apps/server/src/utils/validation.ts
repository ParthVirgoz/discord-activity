/** Discord snowflake IDs are 17–20 digit strings. */
const CHANNEL_ID_REGEX = /^\d{17,20}$/;

/** YouTube video IDs are exactly 11 characters. */
const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

const MAX_TITLE_LENGTH = 200;
const MAX_USERNAME_LENGTH = 32;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 2;
const MAX_SEEK_TIME = 86400; // 24 hours
const MAX_QUEUE_SIZE = 100;
const MAX_VIDEO_DURATION_SEC = 86400;

export function isValidChannelId(channelId: unknown): channelId is string {
  return typeof channelId === "string" && CHANNEL_ID_REGEX.test(channelId);
}

export function isValidVideoId(videoId: unknown): videoId is string {
  return typeof videoId === "string" && YOUTUBE_ID_REGEX.test(videoId);
}

export function sanitizeTitle(title: unknown): string {
  if (typeof title !== "string") return "";
  return title.trim().slice(0, MAX_TITLE_LENGTH);
}

export function sanitizeUsername(username: unknown): string {
  if (typeof username !== "string" || !username.trim()) return "Guest";
  return username.trim().slice(0, MAX_USERNAME_LENGTH);
}

export function clampTime(time: unknown): number {
  const n = typeof time === "number" ? time : Number(time);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_SEEK_TIME);
}

export function clampPlaybackRate(rate: unknown): number {
  const n = typeof rate === "number" ? rate : Number(rate);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, n));
}

export function clampQueueIndex(index: unknown, queueLength: number): number | null {
  const n = typeof index === "number" ? index : Number(index);
  if (!Number.isInteger(n) || n < 0 || n >= queueLength) return null;
  return n;
}

export function clampDuration(seconds: unknown): number {
  const n = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_VIDEO_DURATION_SEC);
}

export { MAX_QUEUE_SIZE, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE };
