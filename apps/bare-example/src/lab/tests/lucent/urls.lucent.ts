// URL and URLSearchParams, by the URL standard, on Ada, the parser Node
// uses too (T105).

function outcome(f: () => string): string {
  try {
    return f();
  } catch (e) {
    if (e instanceof Error) return `${e.name}: ${e.message}`;
    throw e;
  }
}

/** Each input's parts, against `base` when given. */
export function parts(inputs: string[], base: string | undefined): string {
  return inputs
    .map((input) =>
      outcome(() => {
        const u = new URL(input, base);
        return [
          u.href,
          u.origin,
          u.protocol,
          u.username,
          u.password,
          u.host,
          u.hostname,
          u.port,
          u.pathname,
          u.search,
          u.hash,
        ].join(" | ");
      }),
    )
    .join("\n");
}

/** Each part written, and what the URL is after. */
export function written(href: string): string {
  const u = new URL(href);
  const out: string[] = [];
  u.protocol = "http";
  out.push(u.href);
  u.username = "me@x";
  u.password = "p:w";
  out.push(u.href);
  u.host = "other.org:81";
  out.push(u.href);
  u.hostname = "x.y";
  u.port = "abc";
  out.push(u.href);
  u.port = "8080";
  u.port = "80";
  out.push(u.href);
  u.pathname = "a b/c";
  out.push(u.href);
  u.search = "q=a b";
  out.push(`${u.href} ${u.searchParams.get("q") ?? "none"}`);
  u.hash = "#h h";
  out.push(u.href);
  u.protocol = "ftp";
  out.push(u.href);
  u.protocol = "foo";
  out.push(u.href);
  out.push(
    outcome(() => {
      u.href = "::bad";
      return u.href;
    }),
  );
  u.href = "https://new.example/?a=1";
  out.push(`${u.href} ${u.searchParams.get("a") ?? "none"} ${String(u)} ${u.toJSON()}`);
  return out.join("\n");
}

/** A URL's searchParams and its query, each changing the other. */
export function linked(): string {
  const u = new URL("https://a.b/p?x=1&y=2&x=3");
  const p = u.searchParams;
  const out = [`${p.size} ${p.getAll("x").join(",")} ${p === u.searchParams}`];
  p.append("z", "é & =");
  out.push(u.href);
  p.delete("x");
  out.push(u.search);
  p.delete("y", "nope");
  out.push(u.search);
  p.delete("y", "2");
  out.push(u.search);
  u.search = "?k=v&k=w";
  out.push(`${p.size} ${p.getAll("k").join(",")} ${p.has("k", "w")} ${p.has("k", "q")}`);
  p.set("k", "only");
  out.push(u.href);
  p.delete("k");
  p.delete("z");
  out.push(`[${u.search}] ${u.href}`);
  return out.join("\n");
}

export function params(): string {
  const out: string[] = [];
  out.push(new URLSearchParams("?a=1&b=2&a=3").toString());
  out.push(new URLSearchParams("a=b=c&&=x&y=&+plus+=%20%41%zz&%FF=%C3%A9").toString());
  out.push(new URLSearchParams({ b: "2", a: "1", "1": "one" }).toString());
  out.push(
    new URLSearchParams([
      ["x", "1"],
      ["y", "2"],
    ]).toString(),
  );
  out.push(outcome(() => new URLSearchParams([["x", "1", "2"]]).toString()));
  const record: Record<string, string> = {};
  record["k"] = "v w";
  out.push(new URLSearchParams(record).toString());

  const p = new URLSearchParams("z=1&a=2&é=3&a=1&\u{1F600}=4&\uFB01=5&A=6");
  p.sort();
  out.push(p.toString());
  const copy = new URLSearchParams(p);
  copy.append("new", "1");
  out.push(`${p.size} ${copy.size}`);
  out.push(`${String(p.get("missing"))} ${p.get("a") ?? "none"} ${p.has("a")} ${p.has("b")}`);
  const keys: string[] = [];
  for (const k of p.keys()) keys.push(k);
  out.push(keys.join(","));
  out.push([...p.values()].join(","));
  out.push([...p.entries()].map(([k, v]) => `${k}:${v}`).join(","));
  let seen = "";
  p.forEach((value, key, parent) => {
    seen += `${key}=${value}(${parent.size});`;
  });
  out.push(seen);
  // An iterator reads the pairs as they are when it gets to them.
  const live = new URLSearchParams("a=1");
  const it = live.entries();
  live.append("b", "2");
  out.push([...it].map(([k]) => k).join(","));
  out.push(`${new URLSearchParams()}|${new URLSearchParams("")}|${new URLSearchParams("?")}`);
  return out.join("\n");
}

export function statics(): string {
  return [
    URL.canParse("https://x"),
    URL.canParse("x"),
    URL.canParse("x", "https://b/"),
    String(URL.parse("nope")),
    URL.parse("p", "https://b/a/")?.href ?? "null",
    URL.parse(new URL("https://o/"))?.href ?? "null",
    new URL("q", new URL("https://base.example/a/b")).href,
  ].join(" ");
}
