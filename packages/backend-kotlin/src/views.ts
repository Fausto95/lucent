import type { IRExpr } from "@lucent-lang/compiler";
type ViewExpr = Extract<IRExpr, { op: "view" }>;
export function kotlinView(e: ViewExpr, expr: (e: IRExpr) => string): string {
  const prop = (name: string, fallback: string) => {
    const found = e.props.find((p) => p.name === name);
    return found ? expr(found.value) : fallback;
  };
  const children = e.children.map(expr).join("; ");
  if (e.native) {
    const descriptor = e.native.kotlin;
    const rendered = descriptor.template.replace(/{{([^}]+)}}/g, (_, token: string) =>
      token === "children" ? children : prop(token.slice(5), descriptor.defaults?.[token.slice(5)] ?? ""),
    );
    return rendered;
  }
  const render: Record<string, () => string> = {
    TextField: () =>
      `TextField(value = ${prop("value", '""')}, onValueChange = ${prop("onChange", "{}")}, placeholder = { Text(${prop("placeholder", '""')}) })`,
    Toggle: () =>
      `Row { Text(${prop("title", '""')}); Switch(checked = ${prop("value", "false")}, onCheckedChange = ${prop("onChange", "{}")}) }`,
    Slider: () =>
      `Slider(value = (${prop("value", "0.0")}).toFloat(), onValueChange = { ${prop("onChange", "{}")} (it.toDouble()) }, valueRange = (${prop("min", "0.0")}).toFloat()..maxOf((${prop("min", "0.0")}).toFloat(), (${prop("max", "1.0")}).toFloat()))`,
    ScrollView: () => `Column(modifier = Modifier.verticalScroll(rememberScrollState())) { ${children} }`,
    ZStack: () => `Box { ${children} }`,
    Padding: () => `Column(modifier = Modifier.padding((${prop("value", "0.0")}).toFloat().dp)) { ${children} }`,
    Background: () =>
      `Column(modifier = Modifier.background(Color(android.graphics.Color.parseColor(${prop("color", '"#000000"')})))) { ${children} }`,
    CornerRadius: () =>
      `Column(modifier = Modifier.clip(RoundedCornerShape((${prop("value", "0.0")}).toFloat().dp))) { ${children} }`,
    Accessibility: () =>
      `Column(modifier = Modifier.semantics { contentDescription = ${prop("label", '""')} }) { ${children} }`,
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
  "androidx.compose.foundation.background",
  "androidx.compose.foundation.verticalScroll",
  "androidx.compose.foundation.rememberScrollState",
  "androidx.compose.foundation.shape.RoundedCornerShape",
  "androidx.compose.ui.draw.clip",
  "androidx.compose.ui.semantics.semantics",
  "androidx.compose.ui.semantics.contentDescription",
  "androidx.compose.runtime.Composable",
  "androidx.compose.foundation.layout.*",
  "androidx.compose.material3.*",
  "androidx.compose.ui.Modifier",
  "androidx.compose.ui.graphics.Color",
  "androidx.compose.ui.unit.dp",
  "androidx.compose.ui.unit.sp",
];
