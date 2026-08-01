import { clipTokenContext } from "./tokenBudget.js";

const text = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const key = (value) => text(value).toLowerCase();

const MEMORY_SIGNAL = /\b(agree|accept|alliance|aid|border|ceasefire|commit|concession|demand|guarantee|promise|refus|reject|sanction|support|threat|trade|treaty|war|withdraw)\w*\b|(?:\u043e\u0431\u0435\u0449|\u0434\u043e\u0433\u043e\u0432\u043e\u0440|\u0441\u043e\u0433\u043b\u0430\u0441|\u043e\u0442\u043a\u0430\u0437|\u0442\u0440\u0435\u0431\u043e\u0432|\u0443\u0433\u0440\u043e\u0437|\u0441\u0430\u043d\u043a\u0446|\u043f\u043e\u0434\u0434\u0435\u0440\u0436|\u043f\u043e\u043c\u043e\u0449|\u0433\u0440\u0430\u043d\u0438\u0446|\u0442\u043e\u0440\u0433\u043e\u0432|\u043f\u0435\u0440\u0435\u043c\u0438\u0440|\u0430\u043b\u044c\u044f\u043d\u0441|\u0432\u043e\u0439\u043d)\w*/i;

export const normalizeDiplomaticMemory = (value) => {
  if (!value || typeof value !== "object") return null;
  const summary = clipTokenContext(text(value.summary), 3000);
  const commitments = list(value.commitments)
    .map((entry) => clipTokenContext(text(entry), 500))
    .filter(Boolean)
    .slice(0, 12);
  const stance = clipTokenContext(text(value.stance), 800);
  if (!summary && commitments.length === 0 && !stance) return null;
  return {
    summary,
    commitments,
    stance,
    updatedAt: text(value.updatedAt),
    throughMessageCount: Math.max(0, Number(value.throughMessageCount) || 0),
  };
};

const chatInvolvesCountry = (chat, countryKey) =>
  list(chat?.countries).some((entry) => [entry?.name, entry?.code].some((value) => key(value) === countryKey))
  || list(chat?.messages).some((message) => key(message?.speaker) === countryKey);

const memoryForCountry = (chat, countryKey) => {
  const memories = chat?.memories && typeof chat.memories === "object" ? chat.memories : {};
  const entry = Object.entries(memories).find(([identity]) => key(identity) === countryKey)?.[1];
  return normalizeDiplomaticMemory(entry);
};

const messageLine = (message) => {
  const body = clipTokenContext(text(message?.text || message?.message || message?.content), 500);
  if (!body) return "";
  return `${text(message?.speaker || message?.role || "message")}: ${body}`;
};

const extractiveChatMemory = (chat, { active = false } = {}) => {
  const messages = list(chat?.messages).filter((message) => text(message?.text) && message?.role !== "error");
  if (messages.length === 0) return "";

  const selected = new Set();
  selected.add(0);
  messages.forEach((message, index) => {
    if (MEMORY_SIGNAL.test(text(message?.text))) selected.add(index);
  });
  const tailCount = active ? 4 : 2;
  for (let index = Math.max(0, messages.length - tailCount); index < messages.length; index += 1) selected.add(index);

  const lines = [...selected]
    .sort((left, right) => left - right)
    .slice(-10)
    .map((index) => messageLine(messages[index]))
    .filter(Boolean);
  if (lines.length === 0) return "";
  const participants = list(chat?.countries).map((entry) => text(entry?.name || entry?.code)).filter(Boolean).join(", ");
  return [
    `Conversation ${text(chat?.title) || text(chat?.id) || "untitled"}${participants ? ` with ${participants}` : ""} (${text(chat?.status) || "open"}):`,
    ...lines,
  ].join("\n");
};

export const buildCountryDiplomaticMemoryText = (chats, country, {
  activeChatId = "",
  countryMemories = {},
  maxChars = 12000,
} = {}) => {
  const countryKey = key(country);
  if (!countryKey) return "No prior diplomatic memory is recorded.";
  const relevant = list(chats).filter((chat) => chatInvolvesCountry(chat, countryKey));
  const globalMemory = normalizeDiplomaticMemory(
    Object.entries(countryMemories && typeof countryMemories === "object" ? countryMemories : {})
      .find(([identity]) => key(identity) === countryKey)?.[1],
  );
  if (relevant.length === 0 && !globalMemory) return `No prior conversations with ${text(country)} are recorded.`;
  const stored = relevant
    .map((chat) => ({ chat, memory: memoryForCountry(chat, countryKey) }))
    .filter((entry) => entry.memory)
    .sort((left, right) => text(right.memory.updatedAt).localeCompare(text(left.memory.updatedAt)));
  if (globalMemory) stored.unshift({ chat: null, memory: globalMemory });
  const sections = [];
  if (stored.length > 0) {
    const latest = stored[0].memory;
    sections.push([
      `CUMULATIVE MEMORY OF ${text(country)}:`,
      latest.summary,
      latest.stance ? `Current stance: ${latest.stance}` : "",
      ...latest.commitments.map((entry) => `- Commitment/position: ${entry}`),
    ].filter(Boolean).join("\n"));
  }

  // Raw history remains the recovery source for old saves and for details that
  // arrived after the last semantic memory update.
  for (const chat of relevant.slice(0, 8)) {
    const extract = extractiveChatMemory(chat, { active: String(chat?.id) === String(activeChatId) });
    if (extract) sections.push(extract);
  }

  return clipTokenContext(sections.join("\n\n"), maxChars, { preserveEnds: true });
};

export const parseDiplomaticResponse = (raw) => {
  let reply = String(raw ?? "").trimEnd();
  let memory = null;
  let reaction = null;

  const memoryMatch = reply.match(/(?:^|\n)MEMORY_UPDATE\s*:\s*(\{[\s\S]*?\})\s*(?=\nREACTION\s*:|$)/i);
  if (memoryMatch) {
    try {
      memory = normalizeDiplomaticMemory(JSON.parse(memoryMatch[1]));
    } catch {
      memory = null;
    }
    reply = `${reply.slice(0, memoryMatch.index)}${reply.slice(memoryMatch.index + memoryMatch[0].length)}`.trimEnd();
  }

  const reactionMatch = reply.match(/(?:^|\n)REACTION\s*:\s*(\S+)\s*$/i);
  if (reactionMatch) {
    reaction = reactionMatch[1].trim();
    reply = reply.slice(0, reactionMatch.index).trimEnd();
  }

  return { reply, reaction, memory };
};
