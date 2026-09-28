// The fixture's Gauge as React Native's renderer builds its props: reads
// commits from stdin, one line of JSON each (the native view's props as
// the component's proxy renders them), and applies each to the previous
// commit's props, as the renderer does. For each it prints a line of JSON:
// the props (a missing one left out, null as null), the events JavaScript
// listens to, and which props the commit changed.
//
// The renderer reads props from JavaScript objects (on the JavaScript
// thread) or from folly::dynamic (on the others): argv[1] is jsi or
// dynamic.
#include <views/LucentGauge_9f3932d52a2f.h>

#include <folly/json.h>
#include <hermes/hermes.h>
#include <react/renderer/core/RawPropsParser.h>
#include <react/utils/ContextContainer.h>

#include <cstdio>
#include <iostream>
#include <string>

namespace gauge = lucent::views::LucentGauge_9f3932d52a2f;
namespace jsi = facebook::jsi;
namespace react = facebook::react;

namespace {

jsi::Value bits(jsi::Runtime& runtime, const auto& set) {
  std::vector<double> out;

  for (std::size_t i = 0; i < set.size(); ++i)
    if (set.test(i)) out.push_back(static_cast<double>(i));

  return lucent::views::toJs(runtime, out);
}

jsi::Value describe(jsi::Runtime& runtime, const gauge::Props& props, const gauge::Props& previous) {
  const auto& v = props.values;
  jsi::Object values(runtime);

  lucent::views::setOptional(runtime, values, "value", v.value);
  lucent::views::setOptional(runtime, values, "enabled", v.enabled);
  lucent::views::setOptional(runtime, values, "mode", v.mode);
  lucent::views::setOptional(runtime, values, "points", v.points);
  lucent::views::setOptional(runtime, values, "tags", v.tags);
  lucent::views::setOptional(runtime, values, "aria-label", v.aria_u2d_label);

  jsi::Object out(runtime);

  out.setProperty(runtime, "values", values);
  out.setProperty(runtime, "handlers", bits(runtime, props.handlers));
  out.setProperty(runtime, "changed", bits(runtime, props.changed(previous)));

  return out;
}

}  // namespace

int main(int argc, char** argv) {
  const bool fromJsi = argc > 1 && std::string(argv[1]) == "jsi";
  auto hermes = facebook::hermes::makeHermesRuntime();
  jsi::Runtime& runtime = *hermes;
  auto json = runtime.global().getPropertyAsObject(runtime, "JSON");
  auto parse = json.getPropertyAsFunction(runtime, "parse");
  auto stringify = json.getPropertyAsFunction(runtime, "stringify");

  react::RawPropsParser parser;
  parser.prepare<gauge::Props>();

  react::ContextContainer container;
  react::PropsParserContext context{-1, container};

  auto previous = std::make_shared<const gauge::Props>();

  for (std::string line; std::getline(std::cin, line);) {
    react::RawProps raw = fromJsi
        ? react::RawProps(runtime, parse.call(runtime, jsi::String::createFromUtf8(runtime, line)))
        : react::RawProps(folly::parseJson(line));

    raw.parse(parser);

    auto props = std::make_shared<const gauge::Props>(context, *previous, raw);
    auto text = stringify.call(runtime, describe(runtime, *props, *previous));

    std::printf("%s\n", text.getString(runtime).utf8(runtime).c_str());
    previous = props;
  }

  return 0;
}
