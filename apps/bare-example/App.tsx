import { createText, textLength } from "./src/async-text.lucent";
import { nativeOS, bytes, hash, fileRoundTrip, deviceModel, fetchBytes, metadataFailure } from "./src/features.lucent";
import { Counter } from "./src/counter.lucent";
import { advance, evaluate, timestamp, double, progress, report } from "./src/features.lucent";
import { FieldKit } from "./src/field-kit.lucent";
import { FieldScreen } from "./src/field-screen.lucent";
import { StatusBar } from "react-native";
import { useEffect, useRef, useState } from "react";
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
  const nativeText = createText("Lucent 🌍");
  const pendingLengths = Promise.all([textLength(nativeText), textLength(nativeText)]);
  nativeText.dispose();
  check("disposed async native text", await pendingLengths, [9, 9]);
  try {
    await textLength(nativeText);
    check("disposed text rejects new work", false, true);
  } catch {
    check("disposed text rejects new work", true, true);
  }
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
  const probe = new FieldKit("probe");
  check("field kit record", probe.record(), 1);
  check("field kit second record", probe.record(), 2);
  check("field kit digest", probe.digest("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  probe.dispose();
  return rows;
}

export default function App() {
  const kit = useRef(new FieldKit("North ridge"));
  const [notes, setNotes] = useState(["Baseline · 12.4", "Creek bed · 18.1"]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    runChecks().then(setRows, (e: unknown) => setError(String(e)));
  }, []);
  const allOk = rows?.every((r) => r.ok) ?? false;
  const status = error
    ? `ERROR: ${error}`
    : rows === null
      ? "Checking native contract…"
      : allOk
        ? "Contract passed"
        : "Contract failed";
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.kicker}>LUCENT FIELD KIT</Text>
      <Text style={styles.lead}>
        The screen owns its label, gain, and arming flag. The sample log and the record event stay in the app, backed by
        a native FieldKit.
      </Text>
      <FieldScreen
        style={styles.screen}
        title={kit.current.name}
        notes={notes}
        onRecord={() => {
          const count = kit.current.record();
          setNotes((items) => [...items, `Sample ${count} · ridge`]);
        }}
      />
      <Text style={styles.status} accessibilityLabel="lucent-status">
        {status}
      </Text>
      {rows?.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={row.ok ? styles.ok : styles.bad}>{row.ok ? "✓" : "✗"}</Text>
          <Text style={styles.label}>{row.label}</Text>
          <Text style={styles.value}>{row.value}</Text>
        </View>
      ))}
      <StatusBar barStyle="light-content" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 72, paddingHorizontal: 20, paddingBottom: 48, gap: 10, backgroundColor: "#0c1612" },
  kicker: { color: "#c4f778", fontSize: 12, fontWeight: "700", letterSpacing: 1.4 },
  lead: { color: "#d7efe4", fontSize: 16, lineHeight: 22, marginBottom: 8 },
  screen: { height: 560, width: "100%", borderRadius: 22, overflow: "hidden" },
  status: { color: "#e7f6ef", fontSize: 18, fontWeight: "700", marginTop: 12 },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  ok: { color: "#c4f778", fontWeight: "700" },
  bad: { color: "#ff8f80", fontWeight: "700" },
  label: { fontFamily: "Menlo", color: "#d7efe4", flexShrink: 0 },
  value: { fontFamily: "Menlo", color: "#8fb9a8", flexShrink: 1 },
});
