/*! Open Historia — tests for the player's character © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CHARACTER_ABOUT_MAX,
  describeCharacterBrief,
  describeCharacterForAdvisor,
  describeCharacterForLeader,
  describeCharacterForSimulation,
  normalizePlayerCharacters,
  playerCharacterOf,
  withPlayerCharacter,
} from "./playerCharacter.js";

const princess = {
  name: "Элианна Малукшуре",
  standing: "младшая принцесса, 16 лет",
  answersTo: "Королевство Малукшуре",
  about: "Попаданка: в прошлой жизни инженер.",
};

test("a character without a name is nobody, and is dropped", () => {
  assert.deepEqual(normalizePlayerCharacters({ Duzia: { standing: "a clerk" } }), {});
  assert.deepEqual(normalizePlayerCharacters(null), {});
  assert.deepEqual(normalizePlayerCharacters(["x"]), {});
});

test("fields are trimmed, single-lined where they are lines, and capped", () => {
  const long = "a".repeat(CHARACTER_ABOUT_MAX + 50);
  const [entry] = Object.values(normalizePlayerCharacters({ Side: { name: "  Анна \n Ивановна ", about: long, standing: "" } }));
  assert.equal(entry.name, "Анна Ивановна");
  assert.equal(entry.about.length, CHARACTER_ABOUT_MAX);
  assert.equal("standing" in entry, false, "an empty field is left out");
});

test("set, read back under any case, replace and clear", () => {
  let world = withPlayerCharacter({}, "Принцесса Элианна", princess);
  assert.equal(playerCharacterOf(world, "принцесса элианна").name, princess.name);
  world = withPlayerCharacter(world, "ПРИНЦЕССА ЭЛИАННА", { ...princess, standing: "королева" });
  assert.equal(Object.keys(world.playerCharacters).length, 1, "the same polity, not a second entry");
  assert.equal(playerCharacterOf(world, "Принцесса Элианна").standing, "королева");
  world = withPlayerCharacter(world, "Принцесса Элианна", { name: "" });
  assert.equal(playerCharacterOf(world, "Принцесса Элианна"), null);
  assert.deepEqual(world.playerCharacters, {});
});

test("another polity's player sees no character", () => {
  const world = withPlayerCharacter({}, "Принцесса Элианна", princess);
  assert.equal(playerCharacterOf(world, "Королевство Малукшуре"), null);
  assert.equal(describeCharacterForSimulation(playerCharacterOf(world, "Королевство Малукшуре"), "Королевство Малукшуре"), "");
});

test("the simulation is told the player is one person under a state it runs", () => {
  const text = describeCharacterForSimulation(princess, "Принцесса Элианна");
  assert.match(text, /^\[The Player Is One Person, Not a Government\]/);
  assert.match(text, /Элианна Малукшуре, младшая принцесса, 16 лет/);
  assert.match(text, /records the player's side is called "Принцесса Элианна"/);
  assert.match(text, /lives under Королевство Малукшуре, whose government the simulation runs/);
  assert.match(text, /Foreign governments deal with Королевство Малукшуре on state business/);
  assert.match(text, /Попаданка/);
});

test("a character inside the polity they play is told that polity governs itself", () => {
  const text = describeCharacterForSimulation(princess, "Королевство Малукшуре");
  assert.match(text, /does not govern it/);
  assert.doesNotMatch(text, /whose government the simulation runs like any other/);
});

test("without a state above them the world still writes to a person", () => {
  const text = describeCharacterForSimulation({ name: "Том" }, "Том");
  assert.match(text, /deal with the government over them/);
  assert.doesNotMatch(text, /records the player's side is called/, "the records name is the character's own");
});

test("the advisor and a leader get their own framing", () => {
  assert.match(describeCharacterForAdvisor(princess, "Принцесса Элианна"), /^\[Whom You Advise\]\nYou advise Элианна Малукшуре, младшая принцесса/);
  assert.match(describeCharacterForAdvisor(princess), /win from those who rule Королевство Малукшуре/);
  const leader = describeCharacterForLeader(princess);
  assert.match(leader, /^\[Who Is Writing to You\]/);
  assert.match(leader, /Королевство Малукшуре speaks for its state, not they/);
  assert.match(leader, /binds no state|Nothing they say binds a state/);
  assert.equal(describeCharacterForLeader(null), "");
  assert.equal(describeCharacterBrief({ name: "Том" }), "Том");
});
