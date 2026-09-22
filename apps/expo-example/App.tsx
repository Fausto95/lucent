// On-device test screen: runs every Lucent end-to-end case through the
// native C++ modules and compares the output with the expected lines (the
// same code run as plain JavaScript on Node).
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { cases } from "./src/tests";
import type { TestCase } from "./src/tests/types";

type Result = {
  name: string;
  status: "running" | "pass" | "fail";
  lines: string[];
  expected: string[];
  error?: string;
  ms: number;
};

async function runCase(c: TestCase): Promise<Result> {
  const lines: string[] = [];
  const start = Date.now();
  const print = (...args: unknown[]) => lines.push(args.map((a) => String(a)).join(" "));
  let error: string | undefined;
  try {
    c.run(c.module, print, (x: unknown) => x, {});
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  // Async cases print as their promises settle.
  const deadline = Date.now() + 10000;
  while (!error && lines.length < c.expected.length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 50));
  const pass = !error && lines.length === c.expected.length && lines.every((l, i) => l === c.expected[i]);
  return { name: c.name, status: pass ? "pass" : "fail", lines, expected: c.expected, error, ms: Date.now() - start };
}

export default function App() {
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const runAll = useCallback(async () => {
    setRunning(true);
    setResults([]);
    const out: Result[] = [];
    for (const c of cases) {
      const r = await runCase(c);
      out.push(r);
      setResults([...out]);
    }
    setRunning(false);
  }, []);

  useEffect(() => {
    void runAll();
  }, [runAll]);

  const passed = results.filter((r) => r.status === "pass").length;
  const done = !running && results.length === cases.length;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.title}>Lucent · C++ over JSI</Text>
        <Text style={styles.subtitle}>
          {Platform.OS} · {results.length}/{cases.length} run · {passed} passed
        </Text>
        <Text testID="lucent-summary" style={[styles.summary, done && (passed === cases.length ? styles.ok : styles.bad)]}>
          {running ? "Running…" : done ? (passed === cases.length ? "ALL PASSED" : `${cases.length - passed} FAILED`) : ""}
        </Text>
        <Pressable disabled={running} onPress={runAll} style={({ pressed }) => [styles.button, (pressed || running) && styles.pressed]}>
          <Text style={styles.buttonText}>Run again</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {results.map((r) => (
          <Pressable key={r.name} onPress={() => setOpen(open === r.name ? null : r.name)} style={styles.row}>
            <Text style={styles.rowTitle}>
              {r.status === "pass" ? "✅" : "❌"} {r.name} <Text style={styles.ms}>{r.ms} ms</Text>
            </Text>
            {r.error ? <Text style={styles.error}>{r.error}</Text> : null}
            {open === r.name || r.status === "fail" ? (
              <View style={styles.details}>
                {r.expected.map((e, i) => {
                  const got = r.lines[i];
                  const same = got === e;
                  return (
                    <Text key={i} style={[styles.line, !same && styles.lineBad]}>
                      {same ? got : `expected: ${e}\n     got: ${got ?? "(nothing)"}`}
                    </Text>
                  );
                })}
                {r.lines.slice(r.expected.length).map((l, i) => (
                  <Text key={`x${i}`} style={[styles.line, styles.lineBad]}>
                    extra: {l}
                  </Text>
                ))}
              </View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f6f7f5", paddingTop: Platform.OS === "ios" ? 54 : (StatusBar.currentHeight ?? 24) },
  header: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#ccc" },
  title: { fontSize: 22, fontWeight: "700", color: "#111" },
  subtitle: { marginTop: 4, color: "#555" },
  summary: { marginTop: 8, fontSize: 16, fontWeight: "700", color: "#555" },
  ok: { color: "#1a7f37" },
  bad: { color: "#cf222e" },
  button: { marginTop: 10, alignSelf: "flex-start", backgroundColor: "#111", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  pressed: { opacity: 0.5 },
  buttonText: { color: "white", fontWeight: "600" },
  list: { padding: 12, paddingBottom: 48 },
  row: { backgroundColor: "white", borderRadius: 10, padding: 12, marginBottom: 8 },
  rowTitle: { fontSize: 16, fontWeight: "600", color: "#111" },
  ms: { fontSize: 12, fontWeight: "400", color: "#888" },
  error: { marginTop: 6, color: "#cf222e", fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 12 },
  details: { marginTop: 8 },
  line: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 11, color: "#333", marginBottom: 2 },
  lineBad: { color: "#cf222e" },
});
