// `for await` (T106): over a channel, each value until it is closed and
// drained, and over an iterable, each element awaited.
import { Channel, delay } from "lucent:core";

export async function overChannel(): Promise<string> {
  const ch = new Channel<number>("lossless", 8);
  ch.send(1);
  ch.send(2);
  void (async () => {
    await delay(5);
    ch.send(3);
    ch.close();
  })();
  const got: number[] = [];
  for await (const n of ch) got.push(n);
  return got.join(",");
}

export async function leaveEarly(): Promise<string> {
  const ch = new Channel<string>("lossless", 8);
  for (const s of ["a", "b", "c", "d"]) ch.send(s);
  ch.close();
  let first = "";
  for await (const s of ch) {
    first = s;
    if (s === "b") break;
  }
  const rest = await ch.receive();
  return `${first} ${rest}`;
}

export async function overPromises(): Promise<string> {
  const values = [Promise.resolve(1), delay(3).then(() => 2), Promise.resolve(3)];
  let sum = 0;
  for await (const v of values) sum += v;
  const words: string[] = [];
  for await (const w of ["x", "y"]) words.push(w);
  return `${sum} ${words.join("")}`;
}

export async function withDestructuring(): Promise<string> {
  const ch = new Channel<{ id: number; name: string }>("lossless", 4);
  ch.send({ id: 1, name: "one" });
  ch.send({ id: 2, name: "two" });
  ch.close();
  const out: string[] = [];
  for await (const { id, name } of ch) out.push(`${id}=${name}`);
  return out.join(" ");
}

export async function throwsOut(): Promise<string> {
  const ch = new Channel<number>("lossless", 4);
  ch.send(1);
  ch.send(2);
  try {
    for await (const n of ch) if (n === 2) throw new Error("at two");
  } catch (e) {
    return `${(e as Error).message}, closed ${ch.closed}`;
  }
  return "no throw";
}
