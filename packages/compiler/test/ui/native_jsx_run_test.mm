// The Settings fixture (native-jsx-fixture.ts), UIKit views written as JSX,
// mounted as a platform host mounts it (Mac Catalyst): its views and props
// at mount and after a commit, a control event, and unmounting, which
// removes the control's actions and releases the views. Prints one line
// per step; native-jsx-run.test.ts compares.
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
#include <vector>

namespace settings = lucent::views::REGISTRATION;
namespace react = facebook::react;

namespace {

std::shared_ptr<const settings::Props> commit(
    react::RawPropsParser& parser,
    const std::shared_ptr<const settings::Props>& previous,
    const char* json) {
  react::ContextContainer container;
  react::PropsParserContext context{-1, container};
  react::RawProps raw(folly::parseJson(json));

  raw.parse(parser);

  return std::make_shared<const settings::Props>(context, *previous, raw);
}

void say(const std::string& line) { std::printf("%s\n", line.c_str()); }

void pump(double ms) { [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:ms / 1000]]; }

std::string text(NSString* s) { return s ? std::string(s.UTF8String) : "nil"; }

void run() {
  const long refs = lucent::liveNativeRefs();
  auto hermes = facebook::hermes::makeHermesRuntime();
  react::RawPropsParser parser;
  parser.prepare<settings::Props>();

  std::vector<bool> toggles;
  auto content = lucent::ui::Content::create([] {});
  auto host = [&content](auto call) {
    lucent::ui::ContentEntry entry(content);

    call();
  };

  auto empty = std::make_shared<const settings::Props>();
  auto p1 = commit(parser, empty, R"({"p0": "Hello", "p1": true, "e0": true})");
  std::shared_ptr<settings::Mount> mount;

  host([&] {
    mount = settings::Mount::create(*p1, [&toggles](const settings::Event& event) {
      if (auto* toggled = std::get_if<settings::Event0>(&event)) toggles.push_back(toggled->on);
    });
  });

  UIStackView* stack = (UIStackView*)lucent::objc::unwrap(mount->view());
  __weak UIStackView* made = stack;
  UILabel* label = (UILabel*)stack.arrangedSubviews[0];
  UISwitch* control = (UISwitch*)stack.arrangedSubviews[1];

  say("mounted: " + std::to_string(stack.arrangedSubviews.count) + " arranged, spacing " +
      std::to_string(int(stack.spacing)) + ", label " + text(label.text) + " in " +
      std::to_string(label.numberOfLines) + " line, switch " + (control.on ? "on" : "off"));

  auto p2 = commit(parser, p1, R"({"p0": "Bye"})");
  host([&] { mount->update(*p2, *p1); });
  say("committed: label " + text(label.text) + ", switch " + (control.on ? "on" : "off"));

  // The user switches it off: the control's action sends onToggle, on the main thread.
  [control setOn:NO animated:NO];
  [control sendActionsForControlEvents:UIControlEventValueChanged];
  pump(50);
  say(std::string("switched: sent ") + (toggles.empty() ? "nothing" : toggles.back() ? "on" : "off"));

  content.reset();
  mount->dispose();
  say(std::string("disposed: switch actions ") +
      (control.allTargets.count || [control actionsForTarget:nil forControlEvent:UIControlEventValueChanged].count
           ? "kept"
           : "none"));

  mount.reset();
  stack = nil;
  label = nil;
  control = nil;
  say(std::string("released: native references ") + (lucent::liveNativeRefs() == refs ? "all released" : "held") +
      ", stack " + (made ? "kept" : "gone"));
}

}  // namespace

int main() { run(); }
