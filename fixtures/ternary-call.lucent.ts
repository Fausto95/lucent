function pick(value: number): number {
  return value * 2;
}

export function choose(flag: boolean): number {
  const chosen = flag ? pick(1) : pick(2);
  return chosen;
}

export function nested(flag: boolean, other: boolean): number {
  return flag ? pick(3) : other ? pick(4) : 5;
}
