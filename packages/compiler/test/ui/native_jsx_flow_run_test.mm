// The Rows fixture (native-jsx-flow-fixture.ts), mounted as a platform host
// mounts it (Mac Catalyst): conditional children shown and hidden by
// commits, a keyed list reordered, retitled, shortened and grown, the
// stack's arranged views printed after each step, the views kept across
// steps checked by identity, and everything released with the mount.
#import <UIKit/UIKit.h>

#include <views/REGISTRATION.h>

#include <folly/json.h>
#include <hermes/hermes.h>
#include <lucent/native.h>
#include <lucent/platform/ios.h>
#include <lucent/view.h>
#include <react/renderer/core/RawPropsParser.h>
#include <react/utils/ContextContainer.h>

#include <cstdio>
#include <memory>
#include <string>

namespace rows = lucent::views::REGISTRATION;
namespace react = facebook::react;

namespace {

std::shared_ptr<const rows::Props> commit(react::RawPropsParser& parser, const std::shared_ptr<const rows::Props>& previous,
                                          const char* json) {
  react::ContextContainer container;
  react::PropsParserContext context{-1, container};
  react::RawProps raw(folly::parseJson(json));

  raw.parse(parser);

  return std::make_shared<const rows::Props>(context, *previous, raw);
}

void say(const std::string& line) { std::printf("%s\n", line.c_str()); }

std::string text(NSString* s) { return s ? std::string(s.UTF8String) : "nil"; }

/// The stack's arranged labels' texts, and whether its views are its subviews too.
std::string shown(UIStackView* stack) {
  std::string out;
  for (UIView* v in stack.arrangedSubviews) {
    if (!out.empty()) out += " ";
    out += [v isKindOfClass:[UILabel class]] ? text(((UILabel*)v).text) : "?";
  }
  if (stack.subviews.count != stack.arrangedSubviews.count) out += " (subviews differ)";
  return out;
}

/// The arranged label showing `title`.
UILabel* labelOf(UIStackView* stack, const char* title) {
  for (UIView* v in stack.arrangedSubviews)
    if ([v isKindOfClass:[UILabel class]] && text(((UILabel*)v).text) == title) return (UILabel*)v;
  return nil;
}

void run() {
  const long refs = lucent::liveNativeRefs();
  auto hermes = facebook::hermes::makeHermesRuntime();
  react::RawPropsParser parser;
  parser.prepare<rows::Props>();

  auto content = lucent::ui::Content::create([] {});
  auto host = [&content](auto call) {
    lucent::ui::ContentEntry entry(content);

    call();
  };

  auto empty = std::make_shared<const rows::Props>();
  auto props = commit(parser, empty,
                      R"({"p0": "Hello", "p1": false, "p2": false, "p3": [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}, {"id": "c", "title": "C"}]})");
  std::shared_ptr<rows::Mount> mount;
  host([&] { mount = rows::Mount::create(*props, [](const rows::Event&) {}); });

  UIStackView* stack = (UIStackView*)lucent::objc::unwrap(mount->view());
  __weak UIStackView* made = stack;
  say("mounted: " + shown(stack));

  __weak UILabel* first = labelOf(stack, "Hello");
  __weak UILabel* last = labelOf(stack, "end");
  __weak UILabel* a = labelOf(stack, "A");
  __weak UILabel* c = labelOf(stack, "C");

  auto step = [&](const char* name, const char* json) {
    auto next = commit(parser, props, json);
    host([&] { mount->update(*next, *props); });
    props = next;
    say(std::string(name) + ": " + shown(stack));
  };

  step("noted", R"({"p1": true})");
  step("darkened", R"({"p2": true})");
  step("unnoted", R"({"p1": false})");
  say(std::string("kept: ") + (labelOf(stack, "Hello") == first && labelOf(stack, "end") == last ? "fixed labels" : "replaced"));

  step("rotated", R"({"p3": [{"id": "c", "title": "C"}, {"id": "a", "title": "A"}, {"id": "b", "title": "B"}]})");
  say(std::string("moved: ") + (labelOf(stack, "A") == a && labelOf(stack, "C") == c ? "same labels" : "new labels"));

  step("retitled", R"({"p3": [{"id": "c", "title": "C"}, {"id": "a", "title": "A2"}, {"id": "b", "title": "B"}]})");
  say(std::string("renamed: ") + (labelOf(stack, "A2") == a ? "same label" : "new label"));

  step("shortened", R"({"p3": [{"id": "a", "title": "A2"}]})");
  step("grown", R"({"p3": [{"id": "a", "title": "A2"}, {"id": "d", "title": "D"}]})");

  content.reset();
  mount->dispose();
  mount.reset();
  stack = nil;
  say(std::string("released: native references ") + (lucent::liveNativeRefs() == refs ? "all released" : "held") +
      ", stack " + (made ? "kept" : "gone"));
}

}  // namespace

int main() { run(); }
