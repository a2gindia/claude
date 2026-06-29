import test from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../src/lib/retry.js";

test("withRetry — returns on first success (no retry)", async () => {
  let calls = 0;
  const r = await withRetry(async () => {
    calls++;
    return "ok";
  }, { baseMs: 1 });
  assert.equal(r, "ok");
  assert.equal(calls, 1);
});

test("withRetry — retries then succeeds", async () => {
  let calls = 0;
  const r = await withRetry(
    async () => {
      calls++;
      if (calls < 2) throw new Error("boom");
      return "ok";
    },
    { retries: 1, baseMs: 1 },
  );
  assert.equal(r, "ok");
  assert.equal(calls, 2);
});

test("withRetry — throws after exhausting retries", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new Error("always");
        },
        { retries: 2, baseMs: 1 },
      ),
    /always/,
  );
  assert.equal(calls, 3); // 1 initial + 2 retries
});
