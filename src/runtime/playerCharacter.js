/*! Open Historia — the player's character: playing one person rather than a government © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/playerCharacter.test.js
//
// The game's player is a polity, and every prompt says so: the player "runs"
// it, an order is "an attempt by the government of" it, foreign leaders write
// to it as to a ruler. A player who wants to be one person in the world (a
// younger princess at a regent's court, a guild engineer, a captain) had no way
// to say so, and the whole world answered them as a head of state.
//
// The character is that way. It names who the player is, where they stand and
// whom they answer to, and every task that writes the world, advises the player
// or answers them is told to read the player's side as that one person:
//   - the time skip and the tasks about the player's side
//     (describeCharacterForSimulation): orders are this person's own acts,
//     reaching as far as their standing, purse and friends reach; foreign
//     governments deal with the state above them; the world reaches them
//     through the court, the market and rumour;
//   - the advisor (describeCharacterForAdvisor): advice for this person, not a
//     cabinet;
//   - a leader in a chat (describeCharacterForLeader): a letter from a person,
//     which binds no state.
//
// Kept in the world (`world.playerCharacters`, keyed by the polity's name like
// the standing goal, so a rename carries it and a player who switches polity,
// say on taking the throne, plays that polity as its government again). It
// belongs to no turn: undoing a skip does not undo who the player is.
//
// Import-free: the rules on plain data, tested under bare node.

export const CHARACTER_NAME_MAX = 80;
export const CHARACTER_STANDING_MAX = 200;
export const CHARACTER_ANSWERS_TO_MAX = 80;
export const CHARACTER_ABOUT_MAX = 1200;

const asText = (value) => String(value ?? "").replace(/[ \t]+/g, " ").trim();
const asLine = (value) => asText(value).replace(/\s*\n+\s*/g, " ");
const fold = (value) => asLine(value).toLowerCase();

const normalizeCharacter = (entry) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const name = asLine(entry.name).slice(0, CHARACTER_NAME_MAX);
  const standing = asLine(entry.standing).slice(0, CHARACTER_STANDING_MAX);
  const answersTo = asLine(entry.answersTo).slice(0, CHARACTER_ANSWERS_TO_MAX);
  // Paragraphs are kept: a background reads better in its own breaks.
  const about = asText(entry.about).replace(/\n{3,}/g, "\n\n").slice(0, CHARACTER_ABOUT_MAX);
  // A character is someone: without a name there is nobody to play.
  if (!name) return null;
  return {
    name,
    ...(standing ? { standing } : {}),
    ...(answersTo ? { answersTo } : {}),
    ...(about ? { about } : {}),
  };
};

export const normalizePlayerCharacters = (value) => {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [polity, entry] of Object.entries(value)) {
    const key = asLine(polity);
    const character = normalizeCharacter(entry);
    if (key && character) out[key] = character;
  }
  return out;
};

const keyFor = (characters, player) => Object.keys(characters).find((name) => fold(name) === fold(player));

// The character the player plays on behalf of `player` (their polity), or null
// while they play it as its government.
export const playerCharacterOf = (world, player) => {
  const characters = normalizePlayerCharacters(world?.playerCharacters);
  const key = keyFor(characters, player);
  return key ? characters[key] : null;
};

// The world with the player's character set (or, without a name, cleared).
export const withPlayerCharacter = (world, player, character) => {
  const polity = asLine(player);
  if (!polity) return world;
  const characters = normalizePlayerCharacters(world?.playerCharacters);
  const key = keyFor(characters, polity) ?? polity;
  const next = { ...characters };
  const normalized = normalizeCharacter(character);
  if (normalized) next[key] = normalized;
  else delete next[key];
  return { ...world, playerCharacters: next };
};

// "Elianna Malukshure, the younger princess" — the name with the standing.
export const describeCharacterBrief = (character) => {
  const normalized = normalizeCharacter(character);
  if (!normalized) return "";
  return normalized.standing ? `${normalized.name}, ${normalized.standing}` : normalized.name;
};

const aboutLines = (character) => (character.about ? [`Who they are: ${character.about}`] : []);

// What the polity's records call the player's side, when that is not the
// character's own name (the faction the game was started as, or the state they
// live in): every instruction about "its government" means the person.
const recordsNameLine = (character, player) => {
  const polity = asLine(player);
  if (!polity || fold(polity) === fold(character.name)) {
    return `Wherever these instructions speak of the player's government, ministers, officials, territory, treasury or army, read ${character.name} in person: their household, their own purse and the people they can personally command or persuade.`;
  }
  return `In this game's records the player's side is called "${polity}". Wherever these instructions speak of its government, ministers, officials, territory, treasury or army, read ${character.name} in person: their household, their own purse and the people they can personally command or persuade.`;
};

// Whom the person answers to, and what that means for the state above them.
const answersToLine = (character, player) => {
  if (!character.answersTo) return "";
  if (fold(character.answersTo) === fold(player)) {
    return `${character.name} lives under ${character.answersTo}, but does not govern it: its rulers decide its state business themselves, as the simulation plays them, and the player's orders are only what ${character.name} does or tries in person.`;
  }
  return `${character.name} lives under ${character.answersTo}, whose government the simulation runs like any other: it makes its own decisions of state, and it is never the player's to command.`;
};

// The time skip, and every task that writes about the player's side.
export const describeCharacterForSimulation = (character, player = "") => {
  const normalized = normalizeCharacter(character);
  if (!normalized) return "";
  const state = normalized.answersTo || "the government over them";
  return [
    "[The Player Is One Person, Not a Government]",
    `The player plays ${describeCharacterBrief(normalized)}: one person in this world, not a state.`,
    recordsNameLine(normalized, player),
    answersToLine(normalized, player),
    ...aboutLines(normalized),
    "How the world treats one person:",
    `- An order is what ${normalized.name} does or tries in person: asks, persuades, writes, buys, studies, builds, travels. It reaches as far as their standing, money, skills and friends reach. A state act needs someone with the power to take it, and that someone decides for themselves.`,
    `- Foreign governments deal with ${state} on state business. They write to ${normalized.name} only for a reason of their own about this person (curiosity, a bargain, a favour, a threat), and write as to a person of their rank, never as to a ruler.`,
    `- Events about ${normalized.name}'s own circle, work and plans are the player's events. The wider world goes on at its own scale and reaches them through the court, the market, rumour and the people around them.`,
    `- ${normalized.name}'s own efforts (a workshop, an invention, a circle of allies, a plan) are the player's projects; the state's programmes are the state's.`,
  ].filter(Boolean).join("\n");
};

// The advisor: counsel for one person.
export const describeCharacterForAdvisor = (character, player = "") => {
  const normalized = normalizeCharacter(character);
  if (!normalized) return "";
  return [
    "[Whom You Advise]",
    `You advise ${describeCharacterBrief(normalized)}: one person, not a head of government. Advise what they can do with their own standing, purse, skills and allies.${normalized.answersTo ? ` A measure of state is something they would have to win from those who rule ${normalized.answersTo}.` : ""}`,
    recordsNameLine(normalized, player),
    ...aboutLines(normalized),
  ].join("\n");
};

// A leader answering the player in a chat.
export const describeCharacterForLeader = (character) => {
  const normalized = normalizeCharacter(character);
  if (!normalized) return "";
  return [
    "[Who Is Writing to You]",
    `The one writing to you is ${describeCharacterBrief(normalized)}: a person, not a government.${normalized.answersTo ? ` ${normalized.answersTo} speaks for its state, not they.` : ""}`,
    "Answer them as you would answer such a person, with the courtesy, suspicion or interest their rank earns. Nothing they say binds a state, and nothing you grant them binds yours beyond what you would grant a private person of that rank.",
  ].join("\n");
};
