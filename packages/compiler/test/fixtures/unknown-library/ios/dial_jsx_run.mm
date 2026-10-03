// The unknown library's dial written as JSX (dial-jsx.ios.lucent.tsx),
// mounted as a platform host mounts it (Mac Catalyst): made by rule, its
// level from props and commits, its turns as events, and unmounting, which
// releases it. Prints one line per step; unknown-library.test.ts compares.
#import <UIKit/UIKit.h>

#include <views/REGISTRATION.h>

#include <folly/json.h>
#include <hermes/hermes.h>
#include <lucent/native.h>
#include <lucent/platform/ios.h>
#include <lucent/view.h>
#include <react/renderer/core/RawPropsParser.h>
#include <react/utils/ContextContainer.h>

#import "QXNDials.h"

#include <cstdio>
#include <memory>
#include <string>
#include <vector>

namespace dial = lucent::views::REGISTRATION;
namespace react = facebook::react;

namespace {

std::shared_ptr<const dial::Props> commit(
    react::RawPropsParser& parser,
    const std::shared_ptr<const dial::Props>& previous,
    const char* json) {
  react::ContextContainer container;
  react::PropsParserContext context{-1, container};
  react::RawProps raw(folly::parseJson(json));

  raw.parse(parser);

  return std::make_shared<const dial::Props>(context, *previous, raw);
}

void say(const std::string& line) { std::printf("%s\n", line.c_str()); }

std::string number(double v) { return std::to_string(int(v)); }

void pump(double ms) { [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:ms / 1000]]; }

void run() {
  const long refs = lucent::liveNativeRefs();
  auto hermes = facebook::hermes::makeHermesRuntime();
  react::RawPropsParser parser;
  parser.prepare<dial::Props>();

  std::vector<double> turns;
  auto content = lucent::ui::Content::create([] {});
  auto host = [&content](auto call) {
    lucent::ui::ContentEntry entry(content);

    call();
  };

  auto empty = std::make_shared<const dial::Props>();
  auto p1 = commit(parser, empty, R"({"p0": 2, "e0": true})");
  std::shared_ptr<dial::Mount> mount;

  host([&] {
    mount = dial::Mount::create(*p1, [&turns](const dial::Event& event) {
      if (auto* turned = std::get_if<dial::Event0>(&event)) turns.push_back(turned->level);
    });
  });

  QXNDial* view = (QXNDial*)lucent::objc::unwrap(mount->view());
  __weak QXNDial* made = view;

  say("mounted: level " + number(view.qxnLevel));

  auto p2 = commit(parser, p1, R"({"p0": 5})");
  host([&] { mount->update(*p2, *p1); });
  say("committed: level " + number(view.qxnLevel));

  // Turned natively: the block the attribute set posts onTurn to the main thread, which sends it.
  [view qxnTurn:1];
  pump(50);
  say("turned: level " + number(view.qxnLevel) + ", sent " + (turns.empty() ? "nothing" : number(turns.back())));

  content.reset();
  mount->dispose();
  mount.reset();
  view = nil;
  say(std::string("released: native references ") + (lucent::liveNativeRefs() == refs ? "all released" : "held") +
      ", dial " + (made ? "kept" : "gone"));
}

}  // namespace

int main() { run(); }
