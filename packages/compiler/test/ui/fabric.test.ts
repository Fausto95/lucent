import { describe, expect, it } from "vite-plus/test";
import { fabricSources } from "../../src/ui/fabric.ts";
import { CAPTION, CARD, components, GAUGE, PICKER } from "./views-fixture.ts";

const sources = () => fabricSources(components());
const header = (registration: string) => sources().get(`views/${registration}.h`) ?? "";
const source = (registration: string) => sources().get(`views/${registration}.cpp`) ?? "";

describe("Fabric sources", () => {
  it("are a header and a source per component, and the registry", () => {
    expect([...sources().keys()]).toEqual([
      `views/${CAPTION}.h`,
      `views/${CAPTION}.cpp`,
      `views/${CARD}.h`,
      `views/${CARD}.cpp`,
      `views/${GAUGE}.h`,
      `views/${GAUGE}.cpp`,
      `views/${PICKER}.h`,
      `views/${PICKER}.cpp`,
      "views/lucent_views.h",
      "views/lucent_views.cpp",
    ]);
  });

  it("name each component by its registration: namespace, renderer name, registry entry", () => {
    expect(header(GAUGE)).toContain(`namespace lucent::views::${GAUGE} {`);
    expect(source(GAUGE)).toContain(`extern const char ComponentName[] = "${GAUGE}";`);

    const registry = sources().get("views/lucent_views.cpp") ?? "";

    expect(registry).toContain(
      `registry->add(facebook::react::concreteComponentDescriptorProvider<${CAPTION}::ComponentDescriptor>());`,
    );
    expect(registry).toContain(`${GAUGE}::ComponentDescriptor`);
  });

  it("lay out a component taking children as their Yoga container, any other as a measured leaf", () => {
    expect(header(CARD)).toContain(
      "using ShadowNode = lucent::views::SlotShadowNode<ComponentName, Props, EventEmitter>;",
    );
    expect(header(CARD)).toContain('#include "LucentViewSlots.h"');
    expect(header(CARD)).toContain(
      "static std::shared_ptr<Mount> create(const Props& props, Emit emit, lucent::NativeRef slot);",
    );
    expect(header(CAPTION)).toContain(
      "using ShadowNode = lucent::views::HostShadowNode<ComponentName, Props, EventEmitter>;",
    );
    expect(header(CAPTION)).toContain(
      "static std::shared_ptr<Mount> create(const Props& props, Emit emit);",
    );
  });

  it("keep a missing prop, null and a value apart", () => {
    // Every prop may be missing; a nullable one may also be null.
    expect(header(CAPTION)).toContain("std::optional<std::string> text{};");
    expect(header(CAPTION)).toContain("std::optional<std::optional<std::string>> detail{};");
    expect(header(GAUGE)).toContain(
      "std::optional<std::vector<std::optional<std::string>>> tags{};",
    );

    // An object's optional nullable field: missing, null or a number.
    expect(header(GAUGE)).toMatch(
      /struct Object0_ \{\n {2}double x\{\};\n {2}std::optional<std::optional<double>> y\{\};/,
    );
  });

  it("read props and handlers under their transport keys, not their names", () => {
    expect(source(GAUGE)).toContain(
      'out.aria_u2d_label = lucent::views::prop(raw, ComponentName, "aria-label", "p5", source.aria_u2d_label);',
    );
    expect(source(GAUGE)).toContain(
      'lucent::views::handlers(raw, std::array<const char*, 3>{"e0", "e1", "e2"}, source.handlers)',
    );
  });

  it("check an enum's strings and an object's fields", () => {
    expect(source(GAUGE)).toContain(
      'lucent::views::readEnum(raw, out.value, std::array<const char*, 2>{"linear", "radial"});',
    );
    expect(source(GAUGE)).toContain('lucent::views::field(from, "x", out.x);');
    expect(source(GAUGE)).toContain('lucent::views::optionalField(from, "y", out.y);');
  });

  it("send each event by slot, its arguments in order, the optional ones left out as left out", () => {
    const gauge = source(GAUGE);

    // React Native adds the view's tag to a payload as `target`: arguments go by position.
    expect(gauge).toContain('dispatchEvent("lucent0", ');
    expect(gauge).toContain("lucent::views::EventArguments args;");
    expect(gauge).toContain("args.add(runtime, event.value);");
    expect(gauge).toContain("args.addOptional(runtime, event.source);");
    expect(gauge).toContain("return args.payload(runtime);");
    expect(gauge).toContain('dispatchEvent("lucent1", ');
    expect(header(GAUGE)).toContain("void emit(Event1 event) const;");
  });

  it("dispatch each event as its delivery says: discrete, continuous, or coalesced", () => {
    const gauge = source(GAUGE);
    const dispatch = (text: string, name: string) =>
      text.match(new RegExp(`(dispatch\\w*)\\("${name}",[^]*?\\}(, ([\\w:]+))?\\);`))?.[0];

    expect(dispatch(gauge, "lucent0")).toMatch(
      /^dispatchEvent\(.*RawEvent::Category::Discrete\);$/s,
    );
    expect(dispatch(gauge, "lucent1")).toMatch(
      /^dispatchEvent\(.*RawEvent::Category::Discrete\);$/s,
    );
    // React Native keeps only the latest of a view's unique events of a type waiting at the end of its queue.
    expect(dispatch(gauge, "lucent2")).toMatch(/^dispatchUniqueEvent\("lucent2", \[.*\}\);$/s);
    expect(dispatch(source(PICKER), "lucent0")).toMatch(
      /^dispatchEvent\(.*RawEvent::Category::Continuous\);$/s,
    );
  });

  it("give each field of a struct its own C++ name, never the struct's", () => {
    const picker = header(PICKER);

    expect(picker).toMatch(
      /struct Values \{\n {2}std::optional<double> Values_2\{\};\n {2}std::optional<std::string> aria_u2d_label\{\};\n {2}std::optional<std::string> aria_u2d_label_2\{\};/,
    );
    expect(picker).toMatch(
      /struct Event0 \{\n {2}std::string Event0_2\{\};\n {2}std::optional<std::string> target\{\};/,
    );
    expect(source(PICKER)).toContain(
      'out.aria_u2d_label_2 = lucent::views::prop(raw, ComponentName, "aria_u2d_label", "p2", source.aria_u2d_label_2);',
    );
  });

  it("compare an object's fields of any type", () => {
    expect(source(PICKER)).toContain(
      "return lucent::views::sameValue(a.unit, b.unit) && lucent::views::sameValue(a.bounds, b.bounds);",
    );
  });

  it("parse commands, a request's id first", () => {
    const gauge = source(GAUGE);

    expect(header(GAUGE)).toContain("using Command = std::variant<Command0, Command1, Command2>;");
    // What a request answers, which the platform hosts fill (flush answers nothing).
    expect(header(GAUGE)).toContain("using Result1 = double;");
    expect(header(GAUGE)).not.toContain("Result2");
    expect(gauge).toContain('lucent::views::argument(items, 0, "request", command.request_);');
    expect(gauge).toContain('lucent::views::argument(items, 1, "unit", command.unit);');
    expect(header(CAPTION)).not.toContain("parseCommand");
  });

  it("shield the program's names from macros", () => {
    expect(header(GAUGE)).toContain('#pragma push_macro("aria_u2d_label")');
    expect(source(GAUGE)).toContain('#pragma pop_macro("value")');
  });

  it("are the same whatever order the components come in", () => {
    const all = components();

    expect(fabricSources(all.toReversed())).toEqual(fabricSources(all));
    expect(fabricSources(components())).toEqual(fabricSources(all));
  });

  it("match the reviewed output", async () => {
    for (const [name, text] of sources())
      await expect(text).toMatchFileSnapshot(`__snapshots__/fabric/${name}`);
  });
});
