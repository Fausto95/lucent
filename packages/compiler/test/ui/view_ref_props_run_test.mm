// Instance props, mounted as a platform host mounts them (Mac Catalyst,
// UIKit): players made as JavaScript makes them, given ids as the Lucent
// module gives JavaScript, and committed as React Native's renderer parses
// props. A player set, replaced, nulled and left in an array; one freed
// while a commit still names it, and a torn-down runtime's ids; then 1,000
// mounts and unmounts. Prints one line per step; view-ref-props-run.test.ts
// compares them.
#import <UIKit/UIKit.h>

#include <views/REGISTRATION.h>

#include <folly/json.h>
#include <lucent/native.h>
#include <lucent/platform/ios.h>
#include <lucent/view.h>
#include <react/renderer/core/RawPropsParser.h>
#include <react/utils/ContextContainer.h>

#include "LucentViewInstances.h"
#include "lucent_app_C_Player.h"

#include <cstdio>
#include <memory>
#include <string>
#include <vector>

namespace view = lucent::views::REGISTRATION;
namespace react = facebook::react;

namespace {

/// The runtime the ids name, as a host's id would.
constexpr lucent::RuntimeId kRuntime = 7;

using Player = lucent::Ref<lucent_app::C_Player>;

std::shared_ptr<const view::Props> commit(
    react::RawPropsParser& parser,
    const std::shared_ptr<const view::Props>& previous,
    const std::string& json) {
  react::ContextContainer container;
  react::PropsParserContext context{-1, container};
  react::RawProps raw(folly::parseJson(json));

  raw.parse(parser);

  return std::make_shared<const view::Props>(context, *previous, raw);
}

void say(const std::string& line) { std::printf("%s\n", line.c_str()); }

/// A player, as JavaScript's `new Player(title)` makes it.
Player player(const char* title) { return lucent_app::C_Player::create(lucent::String::fromUtf8(title)); }

/// Its id, as __lucentViewInstance gives JavaScript, written as JSON writes a number.
std::string idOf(const Player& p) {
  return std::to_string(static_cast<long long>(lucent::views::instanceIds().idOf(kRuntime, p)));
}

std::string shown(const std::shared_ptr<view::Mount>& mount) {
  UILabel* label = (UILabel*)lucent::objc::unwrap(mount->view());
  return label.text ? std::string(label.text.UTF8String) : "(nil)";
}

void run() {
  const long refs = lucent::liveNativeRefs();
  react::RawPropsParser parser;
  parser.prepare<view::Props>();
  auto emit = [](const view::Event&) {};

  Player a = player("a"), b = player("b"), c = player("c");
  std::weak_ptr<lucent_app::C_Player> weakA = a;
  const std::string idA = idOf(a), idB = idOf(b), idC = idOf(c);

  // The renderer keeps the latest commit's props, and lets the one before go once it applied the next.
  auto empty = std::make_shared<const view::Props>();
  auto current = commit(parser, empty, R"({"p0": )" + idA + R"(, "p2": [)" + idA + "," + idB + "]}");
  auto mount = view::Mount::create(*current, emit);
  auto apply = [&](const std::string& json) {
    auto previous = current;

    current = commit(parser, previous, json);
    mount->update(*current, *previous);
  };

  say("set: " + shown(mount));

  apply(R"({"p0": )" + idB + "}");
  say("replaced: " + shown(mount));

  apply(R"({"p1": [)" + idC + "]}");
  say("next set: " + shown(mount));

  apply(R"({"p1": [null]})");
  say("next nulled: " + shown(mount));

  // JavaScript lets `a` go; the latest commit and the mount still have it, in the queue.
  a.reset();
  say(std::string("a let go: ") + (weakA.expired() ? "freed" : "held") + ", " + shown(mount));

  apply(R"({"p2": [)" + idB + "]}");
  say(std::string("a gone from the queue: ") + (weakA.expired() ? "freed" : "held") + ", " + shown(mount));

  // A commit naming the freed player reads it as missing (reported): the required prop fails, the view stays.
  apply(R"({"p0": )" + idA + "}");
  say("a freed player's id: " + shown(mount));

  // A reload tore the runtime down: its ids name nothing, though `c` lives.
  lucent::views::instanceIds().forget(kRuntime);
  apply(R"({"p0": )" + idC + "}");
  say("a torn-down runtime's id: " + shown(mount));

  mount->dispose();
  mount.reset();
  current.reset();
  std::weak_ptr<lucent_app::C_Player> weakB = b, weakC = c;
  b.reset();
  c.reset();
  say(std::string("unmounted: ") + (weakB.expired() && weakC.expired() ? "players freed" : "players held") +
      ", native references " + (lucent::liveNativeRefs() == refs ? "all released" : "held"));

  // Mounts that come and go, each with a player JavaScript then lets go of.
  constexpr lucent::RuntimeId kNext = kRuntime + 1;
  std::vector<std::weak_ptr<lucent_app::C_Player>> made;

  for (int i = 0; i < 1000; ++i) {
    Player first = player("first"), second = player("second");
    auto id = [&](const Player& p) {
      return std::to_string(static_cast<long long>(lucent::views::instanceIds().idOf(kNext, p)));
    };
    auto p1 = commit(parser, empty, R"({"p0": )" + id(first) + R"(, "p2": []})");
    auto p2 = commit(parser, p1, R"({"p0": )" + id(second) + R"(, "p1": [)" + id(first) + "]}");
    auto m = view::Mount::create(*p1, emit);

    m->update(*p2, *p1);
    m->dispose();
    made.push_back(first);
    made.push_back(second);
  }

  size_t held = 0;
  for (auto& w : made) held += !w.expired();

  say("1000 mounts: " + std::to_string(held) + " players held, native references " +
      (lucent::liveNativeRefs() == refs ? "all released" : "held") + ", ids " +
      (lucent::views::instanceIds().entries(kNext) <= 512 ? "swept" : "kept"));
}

}  // namespace

int main() {
  // As a host calls it: on the main thread, outside any turn of Lucent's main context.
  run();
}
