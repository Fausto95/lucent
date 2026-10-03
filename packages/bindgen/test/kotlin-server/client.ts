/**
 * Sends kotlinc's arguments to a KotlinServer and exits as kotlinc would:
 * its exit code, and what it printed on standard error.
 * Usage: node client.ts <socket> <kotlinc arguments…>
 * Exits with UNREACHABLE when the server does not answer.
 */
import net from "node:net";

const [socket, ...args] = process.argv.slice(2);
const answer: Buffer[] = [];
const connection = net.connect(socket!);

/** Not one of kotlinc's exit codes: the caller runs kotlinc itself. */
const UNREACHABLE = 99;

connection.on("error", () => process.exit(UNREACHABLE));
connection.on("connect", () => connection.write(`${args.join("\t")}\n`));
connection.on("data", (d: Buffer) => answer.push(d));
connection.on("end", () => {
  const text = Buffer.concat(answer).toString("utf8");
  const line = text.indexOf("\n");

  process.stderr.write(text.slice(line + 1));
  process.exit(Number(text.slice(0, line)));
});
