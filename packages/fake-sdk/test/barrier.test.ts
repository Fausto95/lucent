import { expect, test } from "vite-plus/test";
import { createBarrier } from "../src/barrier.ts";

test("started resolves when the peer arrives via wait", async () => {
  const barrier = createBarrier();
  let arrived = false;
  const peer = (async () => {
    await Promise.resolve();
    arrived = true;
    await barrier.wait();
  })();
  await barrier.started();
  expect(arrived).toBe(true);
  barrier.complete();
  await peer;
});

test("complete and release both unblock wait", async () => {
  const a = createBarrier();
  const waitingA = a.wait();
  a.complete();
  await waitingA;

  const b = createBarrier();
  const waitingB = b.wait();
  b.release();
  await waitingB;
});

test("race shape: await started, then complete", async () => {
  const barrier = createBarrier();
  const order: string[] = [];
  const operation = (async () => {
    order.push("work-begin");
    await barrier.wait();
    order.push("work-end");
  })();
  await barrier.started();
  order.push("test-race");
  barrier.complete();
  await operation;
  expect(order).toEqual(["work-begin", "test-race", "work-end"]);
});
