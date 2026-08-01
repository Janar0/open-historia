import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createUserStore,
  hashPassword,
  verifyPassword,
} from "./userAuth.js";

test("local user store hashes passwords and makes the first account admin", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-historia-users-"));
  try {
    const store = createUserStore(dataDir);
    const admin = store.register({
      displayName: "Janaro",
      password: "correct horse battery staple",
      username: "Janaro",
    });
    const player = store.register({
      displayName: "Friend",
      password: "another secure password",
      username: "friend-2",
    });

    assert.equal(admin.role, "admin");
    assert.equal(player.role, "player");
    assert.equal(store.authenticate({ password: "correct horse battery staple", username: "JANARO" }).id, admin.id);
    assert.equal(store.authenticate({ password: "wrong password", username: "janaro" }), null);
    assert.equal(verifyPassword("correct horse battery staple", admin.password), true);
    assert.equal(verifyPassword("wrong password", admin.password), false);

    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "users.json"), "utf8"));
    assert.equal(persisted.users.length, 2);
    assert.equal(persisted.users[0].password.hash.includes("correct"), false);
    assert.equal(persisted.users[0].password.salt.length > 10, true);

    assert.throws(
      () => store.update(admin.id, { enabled: false }),
      /last active admin/,
    );
    store.update(player.id, { enabled: false });
    assert.equal(store.authenticate({ password: "another secure password", username: "friend-2" }), null);
  } finally {
    fs.rmSync(dataDir, { force: true, recursive: true });
  }
});

test("password policy rejects short secrets", () => {
  assert.throws(() => hashPassword("12345"), /at least 6/);
  assert.doesNotThrow(() => hashPassword("123456"));
});
