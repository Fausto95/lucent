/**
 * A download the iOS device runs hold open (T137): `GET /download` answers
 * at once and sends a little every few seconds, so iOS's background session
 * keeps waiting, until `GET /release` ends it. The device run ends the app
 * in between, and iOS starts it again to hand it the session's events.
 * `GET /status` says how many downloads came and whether they were
 * released.
 *
 *   node scripts/held-download.ts [port]   # prints "listening <port>"
 */
import http from "node:http";

const port = Number(process.argv[2] ?? 8099);
let released = false;
let requests = 0;
const held = new Set<http.ServerResponse>();

const CHUNK = Buffer.alloc(1024, "l");

function finish(res: http.ServerResponse): void {
  held.delete(res);
  res.end(CHUNK);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/download")) {
    requests++;
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.write(CHUNK);
    if (released) return finish(res);

    held.add(res);
    const tick = setInterval(() => {
      if (res.writableEnded) clearInterval(tick);
      else res.write(CHUNK);
    }, 5000);
    res.on("close", () => {
      clearInterval(tick);
      held.delete(res);
    });
    return;
  }
  if (url.startsWith("/release")) {
    released = true;
    // A copy: finishing one takes it out of the set.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const r of [...held]) finish(r);
    res.end("released\n");
    return;
  }
  if (url.startsWith("/status")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ requests, held: held.size, released }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, () => console.log(`listening ${port}`));
