// Channel: values from a producer to a consumer, under a policy for when
// the consumer falls behind. A send copies its value (a NativeBuffer
// moves) and never waits; a receive settles with the next value, or
// undefined once the channel is closed and drained.
import { Channel, type ChannelPolicy, type ChannelStats, compute, NativeBuffer } from "lucent:core";

function counts(s: ChannelStats): string {
  return `sent ${s.sent} received ${s.received} dropped ${s.dropped} refused ${s.refused} depth ${s.depth} high ${s.highWater}`;
}

/** Everything waiting, once the channel is closed. */
async function drain(c: Channel<number>): Promise<number[]> {
  c.close();
  const out: number[] = [];
  for (let v = await c.receive(); v !== undefined; v = await c.receive()) out.push(v);
  return out;
}

/** Each policy, sent more than it holds. */
export async function policies(): Promise<string> {
  const lossless = new Channel<number>("lossless", 2);
  const latest = new Channel<number>("latest");
  const drop = new Channel<number>("drop", 2);
  const sent: string[] = [];
  for (const v of [1, 2, 3]) sent.push(`${lossless.send(v)}/${latest.send(v)}/${drop.send(v)}`);
  const lines = [sent.join(" ")];
  for (const c of [lossless, latest, drop])
    lines.push(`${(await drain(c)).join(",")}: ${counts(c.stats())}`);
  return lines.join("\n");
}

function made(policy: ChannelPolicy, capacity?: number): string {
  try {
    return `${new Channel<number>(policy, capacity).closed}`;
  } catch (e) {
    return (e as Error).name;
  }
}

/** A capacity is a whole number from 1, and a latest channel's is 1. */
export function capacities(): string {
  return [
    made("lossless", 0),
    made("drop", 2.5),
    made("latest", 2),
    made("latest", 1),
    made("drop"),
  ].join(" ");
}

/** A receive waiting for a value settles when one is sent. */
export async function waits(): Promise<string> {
  const c = new Channel<string>("lossless");
  const first = c.receive();
  const second = c.receive();
  c.send("a");
  c.send("b");
  return `${await first} ${await second} ${c.stats().depth}`;
}

/** Closed: sends are refused, what waits is still received, then undefined. */
export async function closing(): Promise<string> {
  const c = new Channel<number>("lossless", 4);
  c.send(1);
  const closed = `${c.close()} ${c.close()} ${c.closed} ${c.send(2)}`;
  const got = [await c.receive(), await c.receive(), await c.receive()];
  return `${closed} | ${got.map((v) => `${v}`).join(" ")} | refused ${c.stats().refused}`;
}

/** A sent value is a copy: changes after the send are not the consumer's. */
export async function copies(): Promise<string> {
  const c = new Channel<{ name: string; tags: string[] }>("lossless");
  const item = { name: "a", tags: ["x"] };
  c.send(item);
  item.tags.push("y");
  item.name = "b";
  const got = await c.receive();
  return `${got?.name} ${got?.tags.join(",")} ${item.tags.join(",")}`;
}

/** A NativeBuffer moves into the channel; one the policy drops is closed. */
export async function buffers(): Promise<string> {
  const c = new Channel<NativeBuffer>("latest");
  const a = NativeBuffer.allocate(4);
  const b = NativeBuffer.allocate(8);
  c.send(a);
  c.send(b);
  const got = await c.receive();
  const full = new Channel<NativeBuffer>("lossless", 1);
  const kept = NativeBuffer.allocate(2);
  const refused = NativeBuffer.allocate(3);
  full.send(kept);
  // Refused, the buffer stays the producer's, open.
  const sent = full.send(refused);
  const out = `${a.byteLength} ${b.byteLength} ${got?.byteLength} | ${sent} ${refused.byteLength} | dropped ${c.stats().dropped}`;
  got?.close();
  refused.close();
  full.close();
  return out;
}

function produce(input: { results: Channel<number>; n: number }): number {
  for (let i = 1; i <= input.n; i++) input.results.send(i * i);
  input.results.close();
  return input.n;
}

/** A compute task sends as it goes; module code receives on its own context. */
export async function fromTask(): Promise<string> {
  const results = new Channel<number>("lossless", 64);
  const n = await compute(produce, { results, n: 5 });
  const got: number[] = [];
  for (let v = await results.receive(); v !== undefined; v = await results.receive()) got.push(v);
  return `${n}: ${got.join(",")}`;
}

export class Tally {
  constructor(public n: number) {}

  plus(): number {
    return this.n + 1;
  }
}

/** A class instance is copied as its class, with its methods. */
export async function classes(): Promise<string> {
  const c = new Channel<Tally>("lossless");
  const t = new Tally(1);
  c.send(t);
  t.n = 5;
  const got = await c.receive();
  return `${got?.plus()} ${got === t} ${t.n}`;
}

/** Module state: a channel module code keeps between calls. */
const recent = new Channel<number>("drop", 2);

export function record(v: number): boolean {
  return recent.send(v);
}

export async function recorded(): Promise<string> {
  const got: number[] = [];
  while (recent.stats().depth > 0) got.push((await recent.receive()) ?? -1);
  return got.join(",");
}

/** A subscriber takes each value as it comes, until it is removed or the channel closes. */
export async function subscribed(): Promise<string> {
  const c = new Channel<number>("lossless", 8);
  const got: number[] = [];
  c.send(1);
  const subscription = c.subscribe((v) => {
    got.push(v);
  });
  c.send(2);
  await Promise.resolve();
  await Promise.resolve();
  c.send(3);
  await Promise.resolve();
  await Promise.resolve();
  subscription.remove();
  c.send(4);
  await Promise.resolve();
  const left = c.stats().depth;
  const later = await c.receive();
  return `${got.join(",")} | left ${left} | ${later}`;
}
