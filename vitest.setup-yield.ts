/**
 * Most tests here are synchronous (compiles, spawnSync, SDK extraction), and
 * vitest runs a file's tests back to back in microtasks. A file never gives
 * its worker a turn of the event loop, so the worker cannot read the replies
 * to its RPC calls, and past 60 s vitest reports "Timeout calling
 * onTaskUpdate". Yielding a macrotask after each test lets them through.
 */
import { afterEach } from "vitest";

afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
