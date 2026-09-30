// The Meter fixture's compiled setup, mounted as a platform host mounts it
// (Mac Catalyst, UIKit): props as React Native's renderer builds them,
// commits, the button toggled (its native state callback, subscribed once
// in setup), a new emitter, JavaScript no longer listening, commands and
// their answers, and unmounting, which releases the button setup made. The
// host enters the mount for each of its calls and hears when the mount's
// code ran (its content may have changed size), once per call, and once
// per tap: the callback setup made enters the mount itself. Prints one
// line per step; mount-run.test.ts compares them.
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

namespace meter = lucent::views::REGISTRATION;
namespace jsi = facebook::jsi;
namespace react = facebook::react;

namespace {

std::shared_ptr<const meter::Props> commit(
    react::RawPropsParser& parser,
    const std::shared_ptr<const meter::Props>& previous,
    const char* json) {
  react::ContextContainer container;
  react::PropsParserContext context{-1, container};
  react::RawProps raw(folly::parseJson(json));

  raw.parse(parser);

  return std::make_shared<const meter::Props>(context, *previous, raw);
}

void say(const std::string& line) { std::printf("%s\n", line.c_str()); }

std::string title(UIButton* button, UIControlState state) {
  NSString* t = [button titleForState:state];
  return t ? std::string(t.UTF8String) : "(nil)";
}

std::string titles(UIButton* button) {
  return title(button, UIControlStateNormal) + " / " + title(button, UIControlStateSelected);
}

/**
 * What a tap does: the selection flips, and UIKit calls the button's
 * configuration update handler (here, without a window or a run of the
 * layout pass, directly, as UIKit would).
 */
void toggle(UIButton* button) {
  button.selected = !button.selected;
  if (button.configurationUpdateHandler) button.configurationUpdateHandler(button);
}

void run() {
  const long refs = lucent::liveNativeRefs();
  auto hermes = facebook::hermes::makeHermesRuntime();
  react::RawPropsParser parser;
  parser.prepare<meter::Props>();

  std::vector<std::string> first, second;
  auto record = [](std::vector<std::string>& into) {
    return [&into](const meter::Event& event) {
      if (auto* changed = std::get_if<meter::Event0>(&event)) into.push_back(changed->selected ? "on" : "off");
    };
  };
  auto list = [](const std::vector<std::string>& v) {
    std::string out;
    for (auto& x : v) out += (out.empty() ? "" : ",") + x;
    return "[" + out + "]";
  };

  // What the host hears: the mount's code ran.
  int heard = 0;
  auto content = lucent::ui::Content::create([&heard] { ++heard; });
  // As a host calls the mount: entering it.
  auto host = [&content](auto call) {
    lucent::ui::ContentEntry entry(content);

    call();
  };
  auto since = [&heard, last = 0]() mutable {
    auto n = heard - last;

    last = heard;
    return ", heard " + std::to_string(n);
  };

  auto empty = std::make_shared<const meter::Props>();
  auto p1 = commit(parser, empty, R"({"p0": "Play", "p1": ["Pause"], "e0": true})");
  std::shared_ptr<meter::Mount> mount;

  host([&] { mount = meter::Mount::create(*p1, record(first)); });

  UIButton* button = (UIButton*)lucent::objc::unwrap(mount->view());
  __weak UIButton* made = button;

  say("mounted: " + titles(button) + since());

  // A commit: the effect reading the title runs again, at once on the main thread.
  auto p2 = commit(parser, p1, R"({"p0": "Go"})");
  host([&] { mount->update(*p2, *p1); });
  say("committed: " + titles(button) + since());

  // The subtitle removed: the selected title falls back to the change count.
  auto p3 = commit(parser, p2, R"({"p1": null})");
  mount->update(*p3, *p2);
  say("subtitle removed: " + titles(button) + since());

  // Toggled: the native callback sets a signal; an effect counts and sends onChange.
  toggle(button);
  say("toggled: sent " + list(first) + ", " + titles(button) + since());

  // A new emitter: the callback setup subscribed stays, events follow the route.
  mount->setEmit(record(second));
  toggle(button);
  say("new emitter: first " + list(first) + ", second " + list(second) + since());

  // JavaScript stops listening: nothing is sent, the count goes on.
  auto p4 = commit(parser, p3, R"({"e0": null})");
  mount->update(*p4, *p3);
  toggle(button);
  say("not listening: second " + list(second) + ", " + titles(button) + since());

  // Commands: reset runs on the main thread; changes answers a request.
  std::vector<lucent::views::Answer> answers;
  auto respond = [&answers](lucent::views::Answer a) { answers.push_back(std::move(a)); };

  host([&] { mount->command(meter::parseCommand("reset", folly::dynamic::array()), respond); });
  host([&] { mount->command(meter::parseCommand("changes", folly::dynamic::array(7)), respond); });
  say(std::string("commands: ") + (button.selected ? "selected" : "not selected") + ", answer " +
      std::to_string(int(answers.at(0).request)) + " = " + std::to_string(int(answers.at(0).value(*hermes).getNumber())) +
      since());

  // Unmounting: cleanups run (the callback goes), later calls do nothing.
  // The host stops hearing first: its mount is going.
  content.reset();
  mount->dispose();
  mount->update(*p1, *p4);
  mount->command(meter::parseCommand("changes", folly::dynamic::array(8)), respond);
  say(std::string("disposed: callback ") + (button.configurationUpdateHandler ? "kept" : "gone") + ", " +
      titles(button) + ", answer " + std::to_string(int(answers.at(1).request)) + " " +
      answers.at(1).error.value_or("(none)"));

  // The host lets the disposed mount go (~LucentMounted): what setup made goes with it.
  mount.reset();
  button = nil;
  say(std::string("released: native references ") + (lucent::liveNativeRefs() == refs ? "all released" : "held") +
      ", button " + (made ? "kept" : "gone"));
}

}  // namespace

int main() {
  // As a host calls it: on the main thread, outside any turn of Lucent's main context.
  run();
}
