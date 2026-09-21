import { StatusBar } from "react-native";
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
  const person: Person = { name: "Ada", age: 36, nickname: null, tags: ["math"] };
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
  return rows;
}

export default function App() {
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
      {rows?.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={row.ok ? styles.ok : styles.bad}>{row.ok ? "✓" : "✗"}</Text>
          <Text style={styles.label}>{row.label}</Text>
          <Text style={styles.value}>{row.value}</Text>
        </View>
      ))}
      <StatusBar barStyle="dark-content" />
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
