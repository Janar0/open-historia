import {
  JSON_URLS,
  warmJson,
} from "./assets.js";

export const STARTUP_TIME_BUDGET_MS = 30_000;

const STARTUP_TASKS = [
  {
    id: "critical-state",
    label: "Loading current game state",
    weight: 1,
    // Keep the startup path deliberately narrow. The map protocol can request
    // PMTiles ranges as tiles enter the viewport, whereas warmPmtilesArchive
    // downloads the *entire* archive into memory (countries + regions alone
    // are roughly 160 MB). Chat, events, prompts and advisor data are likewise
    // only needed after their respective panel/action opens. Fetching all of
    // them here made the player wait for data that was never rendered.
    //
    // world and colors are the only small documents the first map render needs;
    // game is needed by the first HUD render. Consumers share these cached
    // requests, so this also prevents a burst of duplicate initial reads.
    run: ({ signal }) =>
      Promise.all([
        warmJson(JSON_URLS.game, { signal }),
        warmJson(JSON_URLS.colors, { signal }),
        warmJson(JSON_URLS.world, { defaultValue: {}, signal }),
      ]),
  },
];

const TOTAL_WEIGHT = STARTUP_TASKS.reduce((sum, task) => sum + task.weight, 0);

const normalizeTaskResult = (result) => {
  if (!result) return 0;

  if (Array.isArray(result)) {
    return result.reduce((sum, entry) => sum + normalizeTaskResult(entry), 0);
  }

  return Number(result.size) || 0;
};

const buildStepState = (activeId, completedIds) =>
  STARTUP_TASKS.map((task) => ({
    id: task.id,
    label: task.label,
    status: completedIds.has(task.id)
      ? "done"
      : activeId === task.id
      ? "active"
      : "pending",
  }));

export const createInitialStartupState = () => ({
  activeId: null,
  completed: 0,
  done: false,
  elapsedMs: 0,
  errors: [],
  loadedBytes: 0,
  progress: 0,
  stage: "Starting preload",
  steps: buildStepState(null, new Set()),
  timeBudgetMs: STARTUP_TIME_BUDGET_MS,
  timedOut: false,
  total: STARTUP_TASKS.length,
});

export const runStartupPreload = async ({
  onProgress,
  timeBudgetMs = STARTUP_TIME_BUDGET_MS,
} = {}) => {
  const completedIds = new Set();
  const errors = [];
  const startedAt = performance.now();
  let completedWeight = 0;
  let loadedBytes = 0;
  let timedOut = false;

  const publish = (stage, activeId = null, done = false) => {
    onProgress?.({
      activeId,
      completed: completedIds.size,
      done,
      elapsedMs: Math.min(timeBudgetMs, performance.now() - startedAt),
      errors: [...errors],
      loadedBytes,
      progress: Math.round((completedWeight / TOTAL_WEIGHT) * 100),
      stage,
      steps: buildStepState(activeId, completedIds),
      timeBudgetMs,
      timedOut,
      total: STARTUP_TASKS.length,
    });
  };

  publish("Preparing the world");

  for (const task of STARTUP_TASKS) {
    const elapsedMs = performance.now() - startedAt;
    const remainingMs = timeBudgetMs - elapsedMs;

    if (remainingMs <= 0) {
      timedOut = true;
      break;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("startup-time-budget"), remainingMs);

    publish(task.label, task.id);

    try {
      const result = await task.run({ signal: controller.signal });
      completedIds.add(task.id);
      completedWeight += task.weight;
      loadedBytes += normalizeTaskResult(result);
    } catch (error) {
      if (controller.signal.aborted) {
        timedOut = true;
        clearTimeout(timeoutId);
        break;
      }

      console.error(`Startup preload failed during "${task.id}":`, error);
      errors.push({
        id: task.id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  publish(
    timedOut
      ? "30-second budget reached. Remaining assets will continue loading in-game"
      : "World is ready",
    null,
    true,
  );

  return {
    durationMs: performance.now() - startedAt,
    errors,
    loadedBytes,
    timedOut,
  };
};
