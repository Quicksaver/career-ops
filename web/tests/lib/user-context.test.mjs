import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants.js";
import nextConfig from "../../next.config.mjs";
import { careerOpsUserId, careerOpsRoot, careerOpsSystemRoot, careerOpsUsersRoot, careerOpsCoreEnv } from "../../src/lib/user-context.mjs";
import { validateUserId } from "../../../lib/user-context.mjs";

const KEYS = ["CAREER_OPS_USER", "CAREER_OPS_ROOT", "CAREER_OPS_USERS_DIR"];

function withEnv(values, run) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of KEYS) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    return run();
  } finally {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("missing user blocks data roots, child environments, and both server modes", () => {
  for (const user of [undefined, "", "   "]) {
    withEnv({ CAREER_OPS_USER: user }, () => {
      for (const resolve of [careerOpsUserId, careerOpsRoot, careerOpsCoreEnv]) {
        assert.throws(resolve, /Set CAREER_OPS_USER=<username>/);
      }
      for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER]) {
        assert.throws(() => nextConfig(phase), /Set CAREER_OPS_USER=<username>/);
      }
    });
  }
});

test("web rejects the same invalid user IDs as the CLI, including traversal", () => {
  for (const user of [".", "..", "../other", "other/user", "other\\user", "/other", "_other", "-other", "two users", "x".repeat(65)]) {
    assert.throws(() => validateUserId(user));
    withEnv({ CAREER_OPS_USER: user }, () => {
      assert.throws(careerOpsRoot, /Invalid CAREER_OPS_USER/);
      assert.throws(careerOpsCoreEnv, /Invalid CAREER_OPS_USER/);
      assert.throws(() => nextConfig(PHASE_PRODUCTION_SERVER), /Invalid CAREER_OPS_USER/);
    });
  }
});

test("selected users have separate data roots while sharing system code", () => {
  const system = path.resolve("fixture-system");
  for (const user of ["alice", "Bob-2.dev_test", "x".repeat(64)]) {
    assert.equal(validateUserId(user), user);
    withEnv({ CAREER_OPS_USER: ` ${user} `, CAREER_OPS_ROOT: system }, () => {
      assert.equal(careerOpsUserId(), user);
      assert.equal(careerOpsSystemRoot(), system);
      assert.equal(careerOpsRoot(), path.join(system, "users", user));
      assert.equal(careerOpsCoreEnv().CAREER_OPS_USER, user);
      assert.equal(careerOpsCoreEnv().CAREER_OPS_USERS_DIR, path.join(system, "users"));
      assert.doesNotThrow(() => nextConfig(PHASE_DEVELOPMENT_SERVER));
    });
  }
});

test("relative and absolute users roots agree with the child CLI environment", () => {
  const system = path.resolve("fixture-system");
  for (const configured of ["alternate-users", path.resolve("fixture-users")]) {
    withEnv({ CAREER_OPS_USER: "test", CAREER_OPS_ROOT: system, CAREER_OPS_USERS_DIR: configured }, () => {
      const users = path.resolve(system, configured);
      assert.equal(careerOpsUsersRoot(), users);
      assert.equal(careerOpsRoot(), path.join(users, "test"));
      assert.equal(careerOpsCoreEnv().CAREER_OPS_USERS_DIR, users);
    });
  }
});

test("system metadata and production builds remain independent of user selection", () => {
  withEnv({}, () => {
    assert.equal(careerOpsSystemRoot(), path.resolve(process.cwd(), ".."));
    assert.doesNotThrow(() => nextConfig(PHASE_PRODUCTION_BUILD));
  });
});
