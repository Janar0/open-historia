import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFigureMeeting, figureBrainMode, isFigureBrainActive } from "../src/Game/AI/figureRules.js";
import { enforceKeyFigureBrainBudget, normalizeKeyFigureEntry } from "../src/runtime/gameState.js";

const fullFigure = (name, polity, extra = {}) => ({
  id: name.toLowerCase().replaceAll(" ", "-"),
  name,
  polity,
  brainMode: "full",
  brainStatus: "active",
  status: "active",
  meetingModes: ["secure-channel", "correspondence"],
  ...extra,
});

test("key figures default to a factual off record", () => {
  const figure = normalizeKeyFigureEntry({ name: "Unnamed minister", polity: "Germany" });
  assert.equal(figureBrainMode(figure), "off");
  assert.equal(figure.brainEnabled, false);
  assert.equal(figure.brainStatus, "dormant");
  assert.equal(isFigureBrainActive(figure), false);
});

test("legacy brainEnabled true remains an explicitly full brain", () => {
  const figure = normalizeKeyFigureEntry({ name: "Wernher von Braun", polity: "Germany", brainEnabled: true });
  assert.equal(figureBrainMode(figure), "full");
  assert.equal(isFigureBrainActive(figure), true);
  assert.deepEqual(figure.meetingModes, ["secure-channel", "correspondence"]);
});

test("the runtime keeps the active full-brain budget bounded", () => {
  const figures = Array.from({ length: 10 }, (_, index) => fullFigure(`Figure ${index}`, "Germany"));
  const bounded = enforceKeyFigureBrainBudget(figures);
  assert.equal(bounded.filter((figure) => figure.brainMode === "full" && figure.brainStatus === "active").length, 8);
  assert.equal(bounded[0].brainMode, "light");
  assert.equal(bounded.at(-1).brainMode, "full");
});

test("cabinet blocks cross-polity figures while secure channel allows them", () => {
  const leaderA = fullFigure("Leader A", "Polity A");
  const leaderB = fullFigure("Leader B", "Polity B");
  const cabinet = evaluateFigureMeeting({ figures: [leaderA, leaderB], playerPolity: "Polity A", gameDate: "1942", meetingMode: "cabinet" });
  const remote = evaluateFigureMeeting({ figures: [leaderA, leaderB], playerPolity: "Polity A", gameDate: "1942", meetingMode: "secure-channel" });
  assert.equal(cabinet.allowed, false);
  assert.match(cabinet.reason, /cabinet/i);
  assert.equal(remote.allowed, true);
});

test("same-polity cabinet and date/liveness checks are explicit", () => {
  const engineer = fullFigure("Engineer A", "Polity A", { birthDate: "1912-03-23", deathDate: "1977-06-16", meetingModes: ["cabinet", "secure-channel"] });
  assert.equal(evaluateFigureMeeting({ figure: engineer, playerPolity: "Polity A", gameDate: "1942", meetingMode: "cabinet" }).allowed, true);
  assert.equal(evaluateFigureMeeting({ figure: engineer, playerPolity: "Polity A", gameDate: "1900", meetingMode: "cabinet" }).allowed, false);
  assert.equal(evaluateFigureMeeting({ figure: engineer, playerPolity: "Polity A", gameDate: "1980", meetingMode: "cabinet" }).allowed, false);
});
