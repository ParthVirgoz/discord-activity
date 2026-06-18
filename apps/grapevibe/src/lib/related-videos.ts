import type { SearchResultItem } from "@/lib/types";

const MAX_RESULTS = 15;

const VARIANT_NOISE =
  /\b(official|video|audio|lyrics?|lyrical|remix|rework|mix|mashup|cover|version|lofi|lo-fi|slowed|reverb|8d|karaoke|unplugged|live|acoustic|feat\.?|ft\.?|hd|4k|full|song|music|mv|sped\s*up|nightcore)\b/gi;

const BROAD_INTENT =
  /\b(songs?|hits|playlist|mix|compilation|medley|jukebox|evergreen|classic|best\s+of|top\s+\d|non\s*stop|nonstop)\b/i;

const DECADE_RE = /\b(19)?(60|70|80|90)s?\b|\b2000s\b/i;

const GENERIC_CHANNELS =
  /^(vevo|t-?series|tips|yrf|sony music|zee music|saregama|tips music|wave music|aditya music|universal music|warner|vevo)$/i;

const TAG_SKIP =
  /\b(lyrics?|karaoke|meme|rick\s*roll|rickroll|official|video|hd|4k|reaction|tutorial|how to)\b/i;

export interface VideoSignals {
  videoId: string;
  title: string;
  channel?: string;
  tags?: string[];
  category?: string;
}

/** @deprecated use VideoSignals */
export type RelatedContext = VideoSignals;

export function normalizeSongKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)|\{.*?\}/g, " ")
    .replace(VARIANT_NOISE, " ")
    .replace(/[^a-z0-9\u0900-\u097F\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "in", "on", "and", "or", "me", "tu", "tum", "hai",
  "ka", "ki", "ke", "ko", "se", "par", "main", "mera", "meri", "tere", "tera",
  "teri", "from", "with", "song", "video", "full",
]);

function significantTokens(key: string): string[] {
  return key.split(" ").filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

export function isSameSongVariant(titleA: string, titleB: string): boolean {
  const a = normalizeSongKey(titleA);
  const b = normalizeSongKey(titleB);
  if (!a || !b) return false;
  if (a === b) return true;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;

  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;

  let overlap = 0;
  for (const t of ta) {
    if (tb.includes(t)) overlap++;
  }
  return overlap / Math.min(ta.length, tb.length) >= 0.6;
}

function isObviousVariant(title: string, baseTitle: string): boolean {
  const lower = title.toLowerCase();
  if (
    !/\b(remix|rework|mix|mashup|cover|lofi|lo-fi|slowed|reverb|8d|karaoke|sped\s*up|nightcore)\b/i.test(
      lower
    )
  ) {
    return false;
  }
  return isSameSongVariant(title, baseTitle);
}

export function filterRelatedCandidates(
  signals: VideoSignals,
  items: SearchResultItem[]
): SearchResultItem[] {
  const seen = new Set<string>();
  const out: SearchResultItem[] = [];

  for (const item of items) {
    if (item.videoId === signals.videoId) continue;
    if (seen.has(item.videoId)) continue;
    if (isSameSongVariant(signals.title, item.title)) continue;
    if (isObviousVariant(item.title, signals.title)) continue;
    seen.add(item.videoId);
    out.push(item);
  }

  return out;
}

function looksLikeBroadSearch(title: string): boolean {
  return BROAD_INTENT.test(title) || DECADE_RE.test(title);
}

function extractArtist(title: string): string | null {
  const patterns = [
    /^([^–—\-|]+?)\s*[\–—\-|]\s+/,
    /^([^–—\-|]+?)\s+from\s+/i,
    /^(.+?)\s+ft\.?\s+/i,
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      const artist = match[1].replace(/\[.*?\]|\(.*?\)/g, "").trim();
      if (artist.length >= 2 && artist.length <= 48 && !BROAD_INTENT.test(artist)) {
        return artist;
      }
    }
  }
  return null;
}

function extractMovieOrAlbum(title: string): string | null {
  const paren = title.match(/\(([^)]+)\)/)?.[1]?.trim();
  if (paren && paren.length > 3 && !TAG_SKIP.test(paren) && !/^\d{4}$/.test(paren)) {
    return paren;
  }
  const pipe = title.match(/\|\s*([^|[\]()]+)/)?.[1]?.trim();
  if (pipe && pipe.length > 3 && !TAG_SKIP.test(pipe)) return pipe;
  return null;
}

function pickUsefulTags(tags: string[], title: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of tags) {
    const tag = raw.trim();
    if (tag.length < 3 || tag.length > 50) continue;
    if (TAG_SKIP.test(tag)) continue;
    if (isSameSongVariant(title, tag)) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 6) break;
  }
  return out;
}

function detectFromText(text: string, patterns: [RegExp, string][]): string | null {
  const lower = text.toLowerCase();
  for (const [re, label] of patterns) {
    if (re.test(lower)) return label;
  }
  return null;
}

const REGION_PATTERNS: [RegExp, string][] = [
  [/\bbollywood\b/, "bollywood"],
  [/\bhindi\b/, "hindi"],
  [/\bpunjabi\b/, "punjabi"],
  [/\btamil\b/, "tamil"],
  [/\btelugu\b/, "telugu"],
  [/\bmalayalam\b/, "malayalam"],
  [/\bbengali\b/, "bengali"],
  [/\bmarathi\b/, "marathi"],
  [/\burdu\b/, "urdu"],
  [/\bk[\s-]?pop\b/, "k-pop"],
  [/\bj[\s-]?pop\b/, "j-pop"],
  [/\blatin\b/, "latin"],
  [/\bcountry\b/, "country"],
];

const GENRE_PATTERNS: [RegExp, string][] = [
  [/\bromantic\b/, "romantic"],
  [/\blove\s+songs?\b/, "love songs"],
  [/\brock\b/, "rock"],
  [/\bpop\b/, "pop"],
  [/\bhip[\s-]?hop\b/, "hip hop"],
  [/\brap\b/, "rap"],
  [/\br&b\b/, "r&b"],
  [/\bsoul\b/, "soul"],
  [/\bjazz\b/, "jazz"],
  [/\bmetal\b/, "metal"],
  [/\bedm\b/, "edm"],
  [/\belectronic\b/, "electronic"],
  [/\bclassical\b/, "classical"],
  [/\bgospel\b/, "gospel"],
  [/\breggae\b/, "reggae"],
  [/\bindie\b/, "indie"],
];

function detectEra(text: string): string | null {
  const m = text.match(DECADE_RE);
  if (!m) return null;
  const raw = m[0].toLowerCase();
  if (raw.includes("2000")) return "2000s";
  const digits = raw.match(/(60|70|80|90)/)?.[1];
  return digits ? `${digits}s` : null;
}

function dedupeQueries(queries: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const key = q.toLowerCase().trim();
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(q.trim());
  }
  return out;
}

/**
 * Build search queries only from the current video's metadata —
 * artist, soundtrack, channel, YouTube tags, detected era/genre.
 */
export function buildSimilarityQueries(signals: VideoSignals): string[] {
  const { title, channel, tags = [] } = signals;
  const queries: string[] = [];

  if (looksLikeBroadSearch(title)) {
    return [title.trim()];
  }

  const artist = extractArtist(title);
  const soundtrack = extractMovieOrAlbum(title);
  const usefulTags = pickUsefulTags(tags, title);
  const metaText = [title, channel, ...usefulTags].filter(Boolean).join(" ");

  const era = detectEra(metaText);
  const region = detectFromText(metaText, REGION_PATTERNS);
  const genre = detectFromText(metaText, GENRE_PATTERNS);

  if (artist) {
    queries.push(`${artist} songs`);
    queries.push(`${artist} hits`);
  }

  if (soundtrack) {
    queries.push(`${soundtrack} songs`);
    queries.push(`${soundtrack} soundtrack`);
  }

  if (channel && !GENERIC_CHANNELS.test(channel)) {
    const ch = channel.trim();
    if (!artist || artist.toLowerCase() !== ch.toLowerCase()) {
      queries.push(`${ch} songs`);
    }
  }

  for (const tag of usefulTags) {
    const lower = tag.toLowerCase();
    if (/\b(songs?|music|hits|playlist)\b/.test(lower)) {
      queries.push(tag);
    } else if (era && lower.includes(era)) {
      queries.push(`${tag} songs`);
    } else if (region && lower.includes(region)) {
      queries.push(tag);
    } else {
      queries.push(`${tag} music`);
    }
  }

  if (era && region) {
    queries.push(`${era} ${region} songs`);
  } else if (era && genre) {
    queries.push(`${era} ${genre} songs`);
  } else if (region && genre) {
    queries.push(`${region} ${genre} songs`);
  } else if (era) {
    queries.push(`${era} music`);
  } else if (region) {
    queries.push(`${region} songs`);
  } else if (genre) {
    queries.push(`${genre} songs`);
  }

  if (queries.length === 0 && artist) {
    queries.push(`${artist} music`);
  }
  if (queries.length === 0 && channel && !GENERIC_CHANNELS.test(channel)) {
    queries.push(`${channel} music`);
  }

  return dedupeQueries(queries);
}

/** Last-resort queries when strict similarity returns nothing. */
export function buildEmergencyQueries(signals: VideoSignals): string[] {
  const queries: string[] = [];
  const { title, channel, category } = signals;

  if (channel?.trim()) {
    queries.push(`${channel.trim()} songs`);
    queries.push(`${channel.trim()} music`);
  }

  const head = title
    .split(/[|\-–—]/)[0]
    ?.replace(/\[.*?\]|\(.*?\)/g, "")
    .trim();
  if (head && head.length >= 3 && head.length <= 80) {
    queries.push(head);
    const words = significantTokens(normalizeSongKey(head)).slice(0, 4);
    if (words.length >= 2) queries.push(`${words.join(" ")} songs`);
  }

  if (category?.toLowerCase() === "music" && channel?.trim()) {
    queries.push(`${channel.trim()} playlist`);
  }

  if (title.trim().length >= 3) {
    queries.push(`${title.split(/[|\-–—(]/)[0].trim()} music`);
  }

  queries.push("music videos");
  return dedupeQueries(queries);
}

/** Keep anything except the current video — used when strict filtering leaves nothing. */
export function filterRelaxed(signals: VideoSignals, items: SearchResultItem[]): SearchResultItem[] {
  const seen = new Set<string>();
  const out: SearchResultItem[] = [];
  for (const item of items) {
    if (item.videoId === signals.videoId) continue;
    if (seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    out.push(item);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(significantTokens(normalizeSongKey(a)));
  const tb = significantTokens(normalizeSongKey(b));
  if (ta.size === 0 || tb.length === 0) return 0;
  let hit = 0;
  for (const t of tb) {
    if (ta.has(t)) hit++;
  }
  return hit / tb.length;
}

/** Rank by closeness to the playing video's artist, channel, tags, era. */
export function rankBySimilarity(
  signals: VideoSignals,
  items: SearchResultItem[]
): SearchResultItem[] {
  const artist = extractArtist(signals.title)?.toLowerCase();
  const usefulTags = pickUsefulTags(signals.tags ?? [], signals.title);
  const metaText = [signals.title, signals.channel, ...usefulTags].join(" ").toLowerCase();
  const era = detectEra(metaText);
  const region = detectFromText(metaText, REGION_PATTERNS);
  const genre = detectFromText(metaText, GENRE_PATTERNS);

  const scored = items.map((item) => {
    let score = 0;
    const t = item.title.toLowerCase();
    const ch = item.channel?.toLowerCase() ?? "";

    if (signals.channel && ch === signals.channel.toLowerCase()) score += 5;
    if (artist && (t.includes(artist) || ch.includes(artist))) score += 4;

    for (const tag of usefulTags) {
      const tl = tag.toLowerCase();
      if (t.includes(tl) || ch.includes(tl)) score += 2;
      score += tokenOverlap(tag, item.title) * 2;
    }

    if (era && t.includes(era)) score += 2;
    if (region && t.includes(region)) score += 2;
    if (genre && t.includes(genre)) score += 1.5;

    score += tokenOverlap(signals.title, item.title) * 0.5;

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

export function mergeAndRankSimilar(
  signals: VideoSignals,
  batches: SearchResultItem[][]
): SearchResultItem[] {
  const merged: SearchResultItem[] = [];
  for (const batch of batches) merged.push(...batch);
  const filtered = filterRelatedCandidates(signals, merged);
  const ranked = rankBySimilarity(signals, filtered);
  return ranked.slice(0, MAX_RESULTS);
}

export { MAX_RESULTS as RELATED_MAX_RESULTS };
