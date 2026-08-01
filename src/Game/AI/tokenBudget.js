const normalizeText = (value) => String(value ?? "");

export const clipTokenContext = (value, maxChars, { preserveEnds = false } = {}) => {
  const text = normalizeText(value);
  const limit = Math.max(0, Number(maxChars) || 0);
  if (!limit || text.length <= limit) return text;
  if (limit < 16) return text.slice(0, limit);

  if (preserveEnds) {
    const marker = "\n...[context clipped]...\n";
    const available = Math.max(2, limit - marker.length);
    const head = Math.ceil(available * 0.55);
    return `${text.slice(0, head)}${marker}${text.slice(-(available - head))}`;
  }

  return `${text.slice(0, limit - 3)}...`;
};

const compactSchemaNode = (value, depth = 0, maxDescriptionDepth = 6) => {
  if (Array.isArray(value)) return value.map((entry) => compactSchemaNode(entry, depth + 1, maxDescriptionDepth));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      // Keep task/section semantics and remove only deeply repeated leaf prose.
      // The giant mutation schemas describe the same primitive several times;
      // validation still uses the original full schema.
      .filter(([key]) => key !== "description" || depth <= maxDescriptionDepth)
      .map(([key, entry]) => [key, compactSchemaNode(entry, depth + 1, maxDescriptionDepth)]),
  );
};

export const compactToolForRequest = (tool, { thresholdChars = 16000 } = {}) => {
  if (!tool || typeof tool !== "object") return tool;
  if (JSON.stringify(tool).length <= thresholdChars) return tool;
  return {
    ...tool,
    schema: compactSchemaNode(tool.schema),
  };
};

const TASK_OUTPUT_TOKEN_BUDGETS = Object.freeze({
  actions: 3072,
  catalystCreation: 1536,
  catalystExecutor: 1536,
  catalystSummary: 1024,
  countryStatSheet: 3072,
  descriptionToAction: 768,
  eventConsolidator: 1536,
  figureBrain: 3072,
  idleDiplomacy: 768,
  nextSpeaker: 192,
  pregameHistory: 4096,
});

// Timeline jumps and game-master mutations intentionally remain uncapped: their
// event arrays can legitimately be large. Every bounded task has a ceiling sized
// for its schema instead of inheriting a provider/model maximum (up to 64k).
export const outputTokenBudgetForTask = (taskKey) => TASK_OUTPUT_TOKEN_BUDGETS[taskKey];

const LOW_REASONING_TASKS = new Set([
  "catalystSummary",
  "descriptionToAction",
  "eventConsolidator",
  "idleDiplomacy",
  "nextSpeaker",
]);
const MEDIUM_REASONING_TASKS = new Set([
  "autoJumpForward",
  "figureBrain",
  "gameMaster",
  "jumpForward",
]);

export const shouldUseTaskReasoning = (taskKey) => {
  if (LOW_REASONING_TASKS.has(taskKey)) return false;
  if (MEDIUM_REASONING_TASKS.has(taskKey)) return true;
  return "low";
};

export const compactRetryAnswer = (value, maxChars = 8000) =>
  clipTokenContext(value, maxChars, { preserveEnds: true });

export const compactConversationHistory = (history, {
  maxChars = 12000,
  maxMessageChars = 3000,
  maxMessages = 11,
} = {}) => {
  const source = Array.isArray(history) ? history : [];
  const selected = [];
  let remaining = Math.max(1, maxChars);

  for (let index = source.length - 1; index >= 0 && selected.length < maxMessages; index -= 1) {
    const entry = source[index];
    const text = normalizeText(entry?.parts?.[0]?.text);
    const clipped = clipTokenContext(text, Math.min(maxMessageChars, remaining), { preserveEnds: true });
    if (!clipped && text) break;
    selected.unshift({
      ...entry,
      parts: [{ ...(entry?.parts?.[0] || {}), text: clipped }],
    });
    remaining -= clipped.length;
    if (remaining <= 0) break;
  }

  // Gemini/Anthropic histories are most portable when a retained window begins
  // with a user turn. A clipped orphan assistant turn adds little context anyway.
  while (selected.length > 1 && selected[0]?.role !== "user") selected.shift();
  return selected;
};
