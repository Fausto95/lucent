// Each iteration of a `for (let …)` gets its own copy of the variable, even
// when the body assigns it: the increment runs on the next iteration's copy.
export function skipping(): number[] {
  const fns: (() => number)[] = [];
  for (let i = 0; i < 6; i++) {
    fns.push(() => i);
    i++;
  }
  return fns.map((f) => f());
}

// A closure that writes the variable writes this iteration's copy only.
export function bumped(): number[] {
  const gets: (() => number)[] = [];
  const bumps: (() => void)[] = [];
  for (let i = 0; i < 3; i++) {
    gets.push(() => i);
    bumps.push(() => {
      i += 10;
    });
  }
  bumps[1]!();
  return gets.map((f) => f());
}

// A `continue` still steps the next iteration's copy.
export function continued(): number[] {
  const fns: (() => number)[] = [];
  for (let i = 0; i < 8; i++) {
    if (i % 3 === 0) {
      i++;
      continue;
    }
    fns.push(() => i * 2);
  }
  return fns.map((f) => f());
}

// Two variables, one the body assigns.
export function pairs(): string[] {
  const fns: (() => string)[] = [];
  for (let i = 0, j = 10; i < 4; i++, j--) {
    fns.push(() => `${i}:${j}`);
    if (i === 1) j -= 5;
  }
  return fns.map((f) => f());
}
