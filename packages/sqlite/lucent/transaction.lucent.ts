import { NativeResource } from "@lucent-lang/core/resources";
import { SQLiteDatabase } from "@lucent-lang/sqlite";

/** Open, run a scoped synchronous transaction, and close. Tx must not escape. */
export async function runTransaction(): Promise<void> {
  const slot = new NativeResource();
  const db = new SQLiteDatabase(":memory:");
  db.transaction((tx): void => {
    tx.execute("INSERT INTO events(id) VALUES (?)", ["e1"]);
  });
  await db.close();
  await slot.close();
}
