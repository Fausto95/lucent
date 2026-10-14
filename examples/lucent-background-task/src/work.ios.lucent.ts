// iOS's background refresh is BGTaskScheduler's (refresh.lucent.ts).

export function scheduleWork(): string {
  return "none";
}

export function workRuns(): string {
  return "none";
}

export async function workInBackground(_ms: number): Promise<string> {
  return "none";
}
