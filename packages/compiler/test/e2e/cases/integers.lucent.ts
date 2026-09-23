// Integer-valued locals and loop counters: the compiler may keep them in
// integer registers, which must never change what the code computes.

export function wraparound(): string {
  let a = 0x7fffffff;
  a = (a + 1) | 0;
  let b = -0x80000000;
  b = (b - 1) | 0;
  let u = 0xffffffff >>> 0;
  const beforeWrap = u;
  u = (u + 1) >>> 0;
  let m = 0;
  m = Math.imul(0x7fffffff, 0x7fffffff);
  return [a, b, beforeWrap, u, m].join(",");
}

export function shifts(value: number, by: number): string {
  let l = value | 0;
  l <<= by;
  let r = value | 0;
  r >>= by;
  let z = value >>> 0;
  z >>>= by;
  return [l, r, z, ~l, (l ^ r) & z].join(",");
}

export function mixed(seed: number): string {
  let h = seed | 0;
  const half = h / 2;
  h = h ^ 3;
  const f = h * 0.5;
  let flip = 0;
  flip = h > 0 ? 1 : -1;
  return `${half} ${h} ${f} ${-h} ${h === 6} ${h + 0.25} ${flip} ${String(h)} ${h.toString(16)}`;
}

export function signedZero(): string {
  let z = 0;
  z = -0;
  let k = 0;
  k = -0 | 0;
  return `${1 / z} ${1 / k}`;
}

export function counters(): string {
  const out: number[] = [];
  for (let i = 10; i > 0; i -= 3) out.push(i);
  for (let i = -2; i <= 2; i++) out.push(i * 0.5);
  for (let i = 0; i < 2.5; i++) out.push(i);
  for (let i = 5; i >= 0; --i) if (i % 2) out.push(-i);
  let sum = 0;
  for (let i = 0; i < 100000; i++) sum = (sum + (i & 7)) | 0;
  out.push(sum);
  const fs: (() => number)[] = [];
  for (let i = 0; i < 3; i++) fs.push(() => i * 10);
  for (const f of fs) out.push(f());
  return out.join(",");
}

export function unsignedAccumulate(n: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < n; i++) {
    h ^= i & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function destructured(p: { z: number }, xs: number[]): string {
  let z = 0;
  ({ z } = p);
  let b = 0;
  [b = 8] = xs;
  let total = 0;
  for (let i = 0; i < 3; i++) {
    total += i;
    if (i === 1) [i] = [2.5];
  }
  return `${z} ${b} ${total}`;
}
