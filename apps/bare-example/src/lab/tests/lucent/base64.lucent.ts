// atob and btoa, by HTML's forgiving base64, with Node's errors (T105).

function outcome(f: () => string): string {
  try {
    return JSON.stringify(f());
  } catch (e) {
    if (e instanceof Error) return `${e.name}: ${e.message}`;
    throw e;
  }
}

export function decoded(inputs: string[]): string {
  return inputs.map((s) => `${JSON.stringify(s)} -> ${outcome(() => atob(s))}`).join("\n");
}

export function encoded(inputs: string[]): string {
  return inputs.map((s) => `${JSON.stringify(s)} -> ${outcome(() => btoa(s))}`).join("\n");
}

/** Text through UTF-8 and base64, and back. */
export function roundTrip(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const encoded = btoa(binary);
  const back = atob(encoded);
  const decoded = new Uint8Array(back.length);
  for (let i = 0; i < back.length; i++) decoded[i] = back.charCodeAt(i);
  return `${encoded} ${new TextDecoder().decode(decoded) === text}`;
}
