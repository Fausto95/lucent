/**
 * Sends a JVM tool's command line to a ToolServer and exits as the command
 * would: its exit code, what it printed on standard output and on standard
 * error. Exits with UNREACHABLE when the server does not answer.
 * Usage: node client.ts <socket> <tool> <arguments…>
 */
import net from "node:net";

/** Not an exit code of the tools: the caller runs the command itself. */
const UNREACHABLE = 99;

const [socket, ...request] = process.argv.slice(2);
const answer: Buffer[] = [];
const connection = net.connect(socket!);

connection.on("error", () => process.exit(UNREACHABLE));
connection.on("connect", () => connection.write(`${request.join("\t")}\n`));
connection.on("data", (d: Buffer) => answer.push(d));
connection.on("end", () => {
  const all = Buffer.concat(answer);
  const first = all.indexOf(10);
  const second = all.indexOf(10, first + 1);
  const code = Number(all.subarray(0, first).toString());
  const outLength = Number(all.subarray(first + 1, second).toString());
  const body = all.subarray(second + 1);

  process.stdout.write(body.subarray(0, outLength));
  process.stderr.write(body.subarray(outLength), () => process.exit(code));
});
