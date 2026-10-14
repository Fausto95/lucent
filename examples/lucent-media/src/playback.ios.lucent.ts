// iOS has no media service: a media session belongs to the app.

export async function start(): Promise<string> {
  return "none";
}

export async function status(): Promise<string> {
  return "none";
}

export async function outliveActivity(): Promise<string> {
  return "none";
}
