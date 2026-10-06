// Lucent runtime — a Flex (T50): lucent:ui's container of native views
// laid out by React Native's Yoga (layout.h), what generated code makes
// for `<Flex style={…}>` and its children. Each platform defines it
// (platform/ios_layout.mm: a UIView subclass; platform/android_layout.cpp
// with dev.lucent.LucentFlexView: a ViewGroup).
//
// Ownership: a Flex writes its direct children's frames, at each of its
// layouts, and nothing else does; its own frame is its parent's (Fabric,
// a native container, an enclosing Flex). Flexes inside one another make
// one tree: the outermost lays it out, each applies its children's
// frames. A child that is no Flex is a leaf, measured by its platform.
//
// Laid out again when its tree changes (a style or `layout` key, a child
// inserted or removed: Yoga's dirty marks) and when its mount's code has
// run (Content's listeners: every leaf measured again, since the code may
// have changed what they show). Main thread only.
#pragma once

#include <memory>
#include <type_traits>
#include <variant>

#include "core.h"
#include "layout.h"
#include "native.h"
#include "ui_children.h"
#include "view.h"

namespace lucent::ui {

/// A child of a Flex: its view, and its node in the Flex's tree.
struct FlexChild {
  NativeRef view;
  std::shared_ptr<LayoutNode> node;
};

namespace flex {

/// A Flex of `content`'s mount: its view, and its node (a root until inserted).
FlexChild container(const std::weak_ptr<Content>& content);

/// `view` as a Flex's child that is no Flex: a leaf its platform measures.
FlexChild leaf(const NativeRef& view);

/// What `parent` does with its children: inserted at an index (the view
/// and its node), removed; a move is a remove and an insert.
ChildOps<FlexChild> ops(const FlexChild& parent);

/// A style value as generated code has it (a number, a string, undefined, a union of them).
template <class T>
LayoutValue value(const T& v) {
  if constexpr (std::is_same_v<T, LayoutValue>) {
    return v;
  } else if constexpr (std::is_arithmetic_v<T>) {
    return static_cast<double>(v);
  } else if constexpr (std::is_same_v<T, String>) {
    return v;
  } else if constexpr (requires { v.has(); v.value(); }) {
    return v.has() ? value(v.value()) : LayoutValue{};
  } else {
    return std::visit([](const auto& x) { return value(x); }, v);
  }
}

}  // namespace flex

}  // namespace lucent::ui
