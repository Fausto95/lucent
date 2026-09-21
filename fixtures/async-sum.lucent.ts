async function scale(value: number): Promise<number> {
  return value * 2;
}

export async function total(values: number[]): Promise<number> {
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return await scale(sum);
}
