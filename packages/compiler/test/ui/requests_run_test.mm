// The Ticket fixture's requests, driven as a platform host drives a mount
// (Mac Catalyst, UIKit): two answered in the order their work ends, one
// failing, one still unanswered when the mount ends, whose work goes on
// and whose answer is then dropped. Prints one line per step;
// requests-run.test.ts compares them.
#import <UIKit/UIKit.h>

#include <views/REGISTRATION.h>

#include <folly/json.h>
#include <hermes/hermes.h>
#include <lucent/platform/ios.h>
#include <react/renderer/core/RawPropsParser.h>
#include <react/utils/ContextContainer.h>

#include <cstdio>
#include <memory>
#include <string>
#include <vector>

namespace ticket = lucent::views::REGISTRATION;
namespace react = facebook::react;

namespace {

std::shared_ptr<const ticket::Props> commit(react::RawPropsParser& parser, const char* json) {
  react::ContextContainer container;
  react::PropsParserContext context{-1, container};
  react::RawProps raw(folly::parseJson(json));

  raw.parse(parser);

  return std::make_shared<const ticket::Props>(context, ticket::Props{}, raw);
}

void say(const std::string& line) { std::printf("%s\n", line.c_str()); }

/** Lets the main thread run what comes due (timers, posted work) for `ms` milliseconds. */
void pump(double ms) { [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:ms / 1000]]; }

std::string join(const std::vector<std::string>& v, const char* separator) {
  std::string out;
  for (const auto& x : v) out += (out.empty() ? "" : separator) + x;
  return out;
}

std::string list(const std::vector<int>& v) {
  std::vector<std::string> text;
  for (int x : v) text.push_back(std::to_string(x));
  return "[" + join(text, ",") + "]";
}

void run() {
  auto hermes = facebook::hermes::makeHermesRuntime();
  react::RawPropsParser parser;
  parser.prepare<ticket::Props>();

  // Held by the routes the host hands the mount, and by nothing else.
  auto emitHeld = std::make_shared<int>(0);
  auto respondHeld = std::make_shared<int>(0);

  std::vector<int> events;
  std::vector<std::string> answers;

  auto emit = [emitHeld, &events](const ticket::Event& event) {
    if (auto* issued = std::get_if<ticket::Event0>(&event)) events.push_back(int(issued->n));
  };
  // A request's value, which an app reads on the JavaScript thread: here, at once.
  auto respond = [respondHeld, &answers, &hermes](lucent::views::Answer a) {
    answers.push_back(
        std::to_string(int(a.request)) +
        (a.error ? " " + *a.error : " = " + std::to_string(int(a.value(*hermes).getNumber()))));
  };

  const long emitBase = emitHeld.use_count();
  const long respondBase = respondHeld.use_count();

  auto props = commit(parser, R"({"p0": "tickets", "e0": true})");
  auto mount = ticket::Mount::create(*props, emit);
  UILabel* label = (UILabel*)lucent::objc::unwrap(mount->view());

  // Answered as their work ends: the second first.
  mount->command(ticket::parseCommand("issue", folly::dynamic::array(1, 5)), respond);
  mount->command(ticket::parseCommand("issue", folly::dynamic::array(2, 0)), respond);
  pump(100);
  say("answered: " + join(answers, ", ") + ", events " + list(events));

  mount->command(ticket::parseCommand("fail", folly::dynamic::array(3)), respond);
  pump(50);
  say("failed: " + answers.back());

  // Unanswered when the mount ends: rejected then, once.
  mount->command(ticket::parseCommand("issue", folly::dynamic::array(4, 30)), respond);
  say("pending: " + std::to_string(answers.size()) + " answers, respond " +
      (respondHeld.use_count() > respondBase ? "held" : "released"));

  mount->dispose();
  say("unmounted: " + (answers.size() == 4 ? answers.back() : std::string("no answer")));

  // Its work goes on (JavaScript's promises are not cancelled), but its answer and event go nowhere.
  pump(100);
  say("late: " + std::to_string(answers.size()) + " answers, events " + list(events) + ", label " +
      label.text.UTF8String);

  // A host that hands a disposed mount a route: nothing takes it.
  mount->setEmit(emit);

  std::vector<std::string> released;
  if (respondHeld.use_count() == respondBase) released.push_back("respond");
  if (emitHeld.use_count() == emitBase) released.push_back("emit");
  if (!mount->view()) released.push_back("view");
  say("released: " + join(released, ", "));
}

}  // namespace

int main() {
  // As a host calls it: on the main thread, outside any turn of Lucent's main context.
  run();
}
