import { nativeOS, bytes, hash, fileRoundTrip, deviceModel, fetchBytes, metadataFailure } from "./src/features.lucent";
import { Counter } from "./src/counter.lucent";
import { advance, evaluate, timestamp, double, progress, report } from "./src/features.lucent";
import { NativeCard } from "./src/native-card.lucent";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { add, clamp, divide, fibonacci, total } from "./src/math.lucent";
import { birthday, checksum, describe, type Person } from "./src/people.lucent";

type Row = { label: string; value: string; ok: boolean };

/** JSON with sorted object keys, since hosts do not promise a key order. */
function canonical(value: unknown): string {
  // oxlint-disable unicorn/no-array-sort -- Hermes has no toSorted; Object.entries is already a fresh array
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
  // oxlint-enable unicorn/no-array-sort
}

async function runChecks(): Promise<Row[]> {
  const rows: Row[] = [];
  const check = (label: string, actual: unknown, expected: unknown) => {
    const value = canonical(actual);
    rows.push({ label, value, ok: value === canonical(expected) });
  };
  check("add(2, 3)", add(2, 3), 5);
  check("fibonacci(20)", fibonacci(20), 6765);
  check("clamp(15, 0, 10)", clamp(15, 0, 10), 10);
  check("await total([1, 2, 3.5])", await total([1, 2, 3.5]), 6.5);
  const person: Person = { name: "Ada", age: 36, nickname: undefined, tags: ["math"] };
  check("birthday(person)", birthday(person), { name: "Ada", age: 37, nickname: null, tags: ["math"] });
  check("describe(person)", describe(person), "Ada (36)");
  check("describe(nicknamed)", describe({ ...person, nickname: "Countess" }), "Countess aka Ada (36)");
  check("checksum(bytes)", checksum(new Uint8Array([250, 10, 1])), 5);
  try {
    divide(1, 0);
    check("divide(1, 0) throws", "no throw", "DIVIDE_BY_ZERO");
  } catch (error) {
    const e = error as { code?: string; message?: string };
    check("divide(1, 0) throws", e.code, "DIVIDE_BY_ZERO");
    check("divide(1, 0) message", e.message, "Cannot divide by zero");
  }
  const counter = new Counter(4);
  check("shared counter method", counter.increment(2), 6);
  check("imported shared counter", advance(counter), 7);
  check("shared counter property", counter.value, 7);
  counter.dispose();
  check("tagged union", evaluate(9), { kind: "ok", value: 3 });
  check("tagged union error", evaluate(-1), { kind: "error", message: "Negative" });
  check("platform clock", Math.abs(timestamp() - Date.now()) < 5000, true);
  check("worker thread", await double(4), 8);
  const emitted = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.remove();
      reject(new Error("Native event timed out"));
    }, 3000);
    const subscription = progress.subscribe((value) => {
      clearTimeout(timer);
      subscription.remove();
      resolve(value);
    });
    report(42);
  });
  check("native event", emitted, 42);
  check("native platform", ["ios", "android"].includes(nativeOS()), true);
  check("owned UTF-8 buffer", Array.from(bytes("é")), [195, 169]);
  check("empty owned buffer", bytes("").length, 0);
  check("native SHA-256", hash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  check("filesystem worker roundtrip", await fileRoundTrip("Lucent 🌍"), "Lucent 🌍");
  check("native device", (await deviceModel()).length > 0, true);
  try {
    await fetchBytes("invalid");
    check("network validation", "no error", "INVALID_URL");
  } catch (error) {
    check("network validation", (error as { code: string }).code, "INVALID_URL");
  }
  try {
    metadataFailure("/tmp/é");
    check("error metadata", "no error", "MISSING");
  } catch (error) {
    const e = error as { code: string; message: string; metadata: unknown };
    check(
      "error envelope",
      { code: e.code, message: e.message, metadata: e.metadata },
      {
        code: "MISSING",
        message: "File\n不存在 🌍",
        metadata: { path: "/tmp/é", attempt: 1, retry: false, detail: null },
      },
    );
  }
  return rows;
}

export default function App() {
  const [presses, setPresses] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    runChecks().then(setRows, (e: unknown) => setError(String(e)));
  }, []);
  const allOk = rows?.every((r) => r.ok) ?? false;
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityLabel="lucent-status">
        {error ? `ERROR: ${error}` : rows === null ? "running…" : allOk ? "ALL OK" : "FAILURES"}
      </Text>
      <NativeCard
        style={{ height: 140, width: "100%" }}
        title={`Native taps: ${presses}`}
        onPress={() => setPresses((n) => n + 1)}
      />
      {rows?.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={row.ok ? styles.ok : styles.bad}>{row.ok ? "✓" : "✗"}</Text>
          <Text style={styles.label}>{row.label}</Text>
          <Text style={styles.value}>{row.value}</Text>
        </View>
      ))}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 80, paddingHorizontal: 20, paddingBottom: 40, gap: 8 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 12 },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  ok: { color: "green", fontWeight: "700" },
  bad: { color: "red", fontWeight: "700" },
  label: { fontFamily: "Menlo", flexShrink: 0 },
  value: { fontFamily: "Menlo", color: "#555", flexShrink: 1 },
});
