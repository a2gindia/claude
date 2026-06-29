import test from "node:test";
import assert from "node:assert/strict";
import { ConcurrencyQueue } from "../src/lib/queue.js";

test("ConcurrencyQueue — never exceeds the limit and runs every task", async () => {
  const q = new ConcurrencyQueue(3);
  let running = 0;
  let maxRunning = 0;

  const task = () =>
    q.enqueue(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return true;
    });

  const results = await Promise.all(Array.from({ length: 10 }, () => task()));
  assert.equal(results.length, 10);
  assert.ok(results.every(Boolean));
  assert.ok(maxRunning <= 3, `maxRunning was ${maxRunning}, expected <= 3`);
});

test("ConcurrencyQueue — propagates task rejection to its caller", async () => {
  const q = new ConcurrencyQueue(2);
  await assert.rejects(() => q.enqueue(async () => { throw new Error("task failed"); }), /task failed/);
});
