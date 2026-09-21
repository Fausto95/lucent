import type { IRExpr } from "@lucent-lang/compiler";
type ViewExpr = Extract<IRExpr, { op: "view" }>;
export function kotlinView(e: ViewExpr, expr: (e: IRExpr) => string): string {
  const prop = (name: string, fallback: string) => {
    const found = e.props.find((p) => p.name === name);
    return found ? expr(found.value) : fallback;
  };
  const children = e.children.map(expr).join("; ");
  const render: Record<string, () => string> = {
    VStack: () =>
      `Column(modifier = Modifier.padding((${prop("padding", "0.0")}).toFloat().dp), verticalArrangement = Arrangement.spacedBy((${prop("spacing", "0.0")}).toFloat().dp)) { ${children} }`,
    HStack: () =>
      `Row(modifier = Modifier.padding((${prop("padding", "0.0")}).toFloat().dp), horizontalArrangement = Arrangement.spacedBy((${prop("spacing", "0.0")}).toFloat().dp)) { ${children} }`,
    Text: () =>
      `Text(text = ${e.children.length ? e.children.map(expr).join(" + ") : '""'}, fontSize = (${prop("size", "17.0")}).toFloat().sp${e.props.some((p) => p.name === "color") ? `, color = Color(android.graphics.Color.parseColor(${prop("color", '"#000000"')}))` : ""})`,
    Spacer: () => `Spacer(modifier = Modifier.size((${prop("size", "8.0")}).toFloat().dp))`,
    Button: () => `Button(onClick = ${prop("onPress", "{}")}) { Text(${prop("title", '""')}) }`,
  };
  return render[e.name]!();
}
export const kotlinViewImports = [
  "androidx.compose.runtime.Composable",
  "androidx.compose.foundation.layout.*",
  "androidx.compose.material3.*",
  "androidx.compose.ui.Modifier",
  "androidx.compose.ui.graphics.Color",
  "androidx.compose.ui.unit.dp",
  "androidx.compose.ui.unit.sp",
];
