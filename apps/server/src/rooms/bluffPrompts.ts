/** Fibbage-style prompts — players submit fake answers, then vote for the truth. */
export const BLUFF_PROMPTS: { prompt: string; answer: string }[] = [
  { prompt: "The worst thing to say at a wedding is _____.", answer: "Does anyone object?" },
  { prompt: "A rejected title for Star Wars was _____.", answer: "Adventures of the Luke Starkiller" },
  { prompt: "The secret ingredient in grandma's cookies is _____.", answer: "Instant coffee" },
  { prompt: "The next Olympic sport should definitely be _____.", answer: "Extreme ironing" },
  { prompt: "On the moon, astronauts discovered _____.", answer: "A lost shopping cart" },
  { prompt: "The Wi-Fi password at Area 51 is _____.", answer: "AliensOnly2024" },
  { prompt: "Cats secretly call humans _____.", answer: "Can openers" },
  { prompt: "The most useless superpower would be _____.", answer: "Always knowing when soup is lukewarm" },
  { prompt: "In the dinosaur era, T-Rex couldn't reach its _____.", answer: "Back scratchers" },
  { prompt: "The first message ever sent on the internet was _____.", answer: "LO" },
  { prompt: "Pirates buried their treasure next to _____.", answer: "A very detailed map" },
  { prompt: "The real reason dinosaurs went extinct: _____.", answer: "They forgot to renew their lease" },
  { prompt: "A terrible name for a restaurant is _____.", answer: "The Food Poisoning Café" },
  { prompt: "Scientists were shocked to find _____. inside a black hole.", answer: "Unmatched socks" },
  { prompt: "The boogeyman is actually afraid of _____.", answer: "Tax season" },
  { prompt: "The most popular baby name in 2030 will be _____.", answer: "Bluetooth" },
  { prompt: "Knights used to polish their armor with _____.", answer: "Expired mayonnaise" },
  { prompt: "The Loch Ness Monster is just a _____.", answer: "Very committed otter" },
  { prompt: "Aliens refuse to visit Earth because of _____.", answer: "Our group chat drama" },
  { prompt: "The last thing you want in your submarine is _____.", answer: "A screen door" },
  { prompt: "Medieval doctors treated headaches with _____.", answer: "More headaches" },
  { prompt: "The true purpose of Stonehenge was _____.", answer: "Ancient mini golf" },
  { prompt: "Vampires are allergic to _____.", answer: "Garlic bread enthusiasm" },
  { prompt: "The worst pizza topping is obviously _____.", answer: "Regret" },
  { prompt: "In parallel universes, everyone has _____.", answer: "A goatee" },
  { prompt: "The first rule of Fight Club is you do not talk about _____.", answer: "Fight Club" },
  { prompt: "Bigfoot's day job is _____.", answer: "Nature photography model" },
  { prompt: "The Sphinx's nose fell off because of _____.", answer: "A very bad sneeze" },
  { prompt: "Time travelers keep breaking _____.", answer: "The vending machines" },
  { prompt: "The most cursed item in a thrift store is _____.", answer: "A haunted fidget spinner" },
];

export const DECOY_ANSWERS = [
  "Emotional support alligator",
  "A USB-C to regret adapter",
  "Grandma's revenge",
  "Premium disappointment",
  "A suspiciously wet sock",
  "Government-issued chaos",
  "The forbidden snack",
  "An aggressive pigeon",
  "Expired confidence",
  "A cursed participation trophy",
];

export const MIN_PLAYERS = 3;
export const MAX_ROUNDS = 5;
export const SUBMIT_SECONDS = 45;
export const VOTE_SECONDS = 30;
export const REVEAL_SECONDS = 8;
