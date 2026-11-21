import assert from "node:assert/strict";
import test from "node:test";

import {
  claimsTacticalGround,
  sanitizeUngroundedTacticalEvents,
} from "../src/Game/AI/tacticalNarration.js";

test("capture wording for a city or cell is recognised in both languages", () => {
  assert.equal(claimsTacticalGround("Kharkiv city secured"), true);
  assert.equal(claimsTacticalGround("Харьковская клетка захвачена"), true);
  assert.equal(claimsTacticalGround("Front exchanges fire with no advance"), false);
  assert.equal(claimsTacticalGround("Фронт удержан, но продвижения не было"), false);
});

test("final salvage removes an ungrounded capture but keeps a grounded event", () => {
  const candidate = {
    events: [
      {
        title: "Kharkiv bridgehead secured",
        description: "The flank is held.",
        impacts: { unitOps: [{ op: "move", unitId: "r-1" }] },
      },
      {
        title: "Third cell secured",
        description: "The front advances.",
        impacts: { sectorOps: [{ op: "upsert", sector: { id: "front-1" } }] },
      },
    ],
  };

  assert.deepEqual(sanitizeUngroundedTacticalEvents(candidate), [0]);
  assert.equal(candidate.events[0].title, "Front — fighting continues");
  assert.match(candidate.events[0].description, /no confirmed change/i);
  assert.equal(candidate.events[1].title, "Third cell secured");
});
