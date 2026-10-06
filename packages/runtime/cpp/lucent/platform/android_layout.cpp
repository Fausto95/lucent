// Lucent runtime — a Flex on Android (T50, ui_flex.h): the C++ side of
// dev.lucent.LucentFlexView, a ViewGroup laid out with the layout core.
// Its onMeasure and onLayout call in here: the outermost Flex of a tree
// lays the tree out (in density-independent pixels, snapped to the
// screen's pixels), and each Flex measures and lays out its own children
// at the frames it computed. A leaf is measured by View.measure, which
// never reads the frame a Flex gave it.
//
// Each Flex's side lives as long as the scope it was made in (its mount,
// an item's, a branch's): ending it lets the children's references go and
// leaves the view laying nothing out. Main thread only.
#if defined(__ANDROID__) || defined(LUCENT_JNI_HOST)

#include <algorithm>
#include <cmath>
#include <map>
#include <memory>
#include <stdexcept>
#include <vector>

#include "../ui_flex.h"
#include "android.h"

namespace lucent::ui::flex {

namespace {

constexpr jint kExactly = 1 << 30;
constexpr jint kAtMost = 2 << 30;

/// A Flex's C++ side.
struct Side {
  std::shared_ptr<LayoutNode> node;
  std::vector<FlexChild> children;
  jweak view = nullptr;
  float density = 1;
  std::weak_ptr<Content> content;
  size_t listener = 0;
};

std::map<jlong, std::shared_ptr<Side>>& sides() {
  static std::map<jlong, std::shared_ptr<Side>> all;
  return all;
}

std::shared_ptr<Side> sideOf(jlong id) {
  auto found = sides().find(id);
  return found == sides().end() ? nullptr : found->second;
}

std::shared_ptr<Side> sideOf(const std::shared_ptr<LayoutNode>& node) {
  for (auto& [id, side] : sides())
    if (side->node == node) return side;
  throw std::logic_error("a Flex's child inserted into no Flex");
}

LayoutDirection directionOf(jboolean rtl) { return rtl ? LayoutDirection::RTL : LayoutDirection::LTR; }

/// A spec's bound in density-independent pixels (NaN: none).
float boundOf(jint mode, jint size, float density) { return mode == 0 ? NAN : static_cast<float>(size) / density; }

jint specOf(float size, MeasureMode mode, float density) {
  if (mode == MeasureMode::Undefined) return 0;

  const jint px = static_cast<jint>(std::ceil(size * density));
  return px | (mode == MeasureMode::Exactly ? kExactly : kAtMost);
}

jfloatArray measured(JNIEnv* env, jclass, jlong id, jint wm, jint w, jint hm, jint h, jboolean rtl) {
  auto side = sideOf(id);
  if (!side) return nullptr;

  float width = static_cast<float>(w);
  float height = static_cast<float>(h);

  // The tree's root fits its bounds; inside another Flex, the root decided.
  if (!side->node->parent() && !(wm == kExactly && hm == kExactly)) {
    side->node->setPointScale(side->density);

    const auto fits = side->node->fit(wm == kExactly ? static_cast<float>(w) / side->density : boundOf(wm, w, side->density),
                                      hm == kExactly ? static_cast<float>(h) / side->density : boundOf(hm, h, side->density),
                                      directionOf(rtl));
    if (wm != kExactly) width = fits.width * side->density;
    if (hm != kExactly) height = fits.height * side->density;
  }

  jfloatArray out = env->NewFloatArray(2);
  const jfloat size[2] = {width, height};
  env->SetFloatArrayRegion(out, 0, 2, size);
  return out;
}

void laidOut(JNIEnv* env, jclass, jlong id, jint width, jint height, jboolean rtl) {
  auto side = sideOf(id);
  if (!side) return;

  if (!side->node->parent()) {
    side->node->setPointScale(side->density);
    side->node->calculate(static_cast<float>(width) / side->density, static_cast<float>(height) / side->density,
                          directionOf(rtl));
  }

  static const jclass view = jni::findClass("android/view/View");
  static const jmethodID measure = jni::method(view, "measure", "(II)V");
  static const jmethodID layout = jni::method(view, "layout", "(IIII)V");

  for (auto& child : side->children) {
    const auto f = child.node->frame();
    const jint left = static_cast<jint>(std::lround(f.x * side->density));
    const jint top = static_cast<jint>(std::lround(f.y * side->density));
    const jint right = static_cast<jint>(std::lround((f.x + f.width) * side->density));
    const jint bottom = static_cast<jint>(std::lround((f.y + f.height) * side->density));
    jobject v = jni::unwrap(child.view);

    env->CallVoidMethod(v, measure, (right - left) | kExactly, (bottom - top) | kExactly);
    jni::check(env);
    env->CallVoidMethod(v, layout, left, top, right, bottom);
    jni::check(env);
  }
}

jclass flexClass(JNIEnv* env) {
  static jclass cls = [&] {
    jclass c = jni::findClass("dev/lucent/LucentFlexView");
    JNINativeMethod natives[] = {
        {const_cast<char*>("measure"), const_cast<char*>("(JIIIIZ)[F"), reinterpret_cast<void*>(measured)},
        {const_cast<char*>("layout"), const_cast<char*>("(JIIZ)V"), reinterpret_cast<void*>(laidOut)},
    };
    env->RegisterNatives(c, natives, 2);
    jni::check(env);
    return c;
  }();
  return cls;
}

void requestLayout(jweak view) {
  JNIEnv* env = jni::env();
  jobject strong = env->NewLocalRef(view);
  if (!strong) return;

  static const jmethodID request = jni::method(jni::findClass("android/view/View"), "requestLayout", "()V");
  env->CallVoidMethod(strong, request);
  env->DeleteLocalRef(strong);
  jni::check(env);
}

}  // namespace

FlexChild container(const std::weak_ptr<Content>& content) {
  JNIEnv* env = jni::env();
  jclass cls = flexClass(env);
  static jlong next = 0;
  const jlong id = ++next;

  auto side = std::make_shared<Side>();
  side->node = LayoutNode::create();
  side->content = content;

  static const jmethodID make = jni::method(cls, "<init>", "(Landroid/content/Context;J)V");
  const NativeRef context = jni::viewContext();
  const NativeRef view = jni::wrap(env, env->NewObject(cls, make, jni::unwrap(context), id), "<Flex>");
  side->view = env->NewWeakGlobalRef(jni::unwrap(view));

  // Its density: what a density-independent pixel is in the screen's.
  static const jmethodID resources = jni::method(cls, "getResources", "()Landroid/content/res/Resources;");
  static const jmethodID metrics =
      jni::method(jni::findClass("android/content/res/Resources"), "getDisplayMetrics", "()Landroid/util/DisplayMetrics;");
  static const jfieldID density = jni::field(jni::findClass("android/util/DisplayMetrics"), "density", "F");
  jobject res = env->CallObjectMethod(jni::unwrap(view), resources);
  jni::check(env);
  jobject display = env->CallObjectMethod(res, metrics);
  jni::check(env);
  side->density = env->GetFloatField(display, density);
  env->DeleteLocalRef(display);
  env->DeleteLocalRef(res);

  const jweak weak = side->view;
  side->node->onDirtied([weak] { requestLayout(weak); });

  std::weak_ptr<Side> held = side;
  if (auto c = content.lock())
    side->listener = c->listen([held] {
      auto s = held.lock();
      if (s && !s->node->parent()) s->node->dirtyLeaves();
    });

  sides().emplace(id, side);

  // Gone with the scope it is made in: its children's references go, and its view lays nothing out.
  mainGraph()->onCleanup([id] {
    auto s = sideOf(id);
    if (!s) return;

    JNIEnv* e = jni::env();
    static const jfieldID flex = jni::field(jni::findClass("dev/lucent/LucentFlexView"), "flex", "J");
    if (jobject v = e->NewLocalRef(s->view)) {
      e->SetLongField(v, flex, 0);
      e->DeleteLocalRef(v);
    }

    if (auto c = s->content.lock()) c->unlisten(s->listener);
    s->node->onDirtied(nullptr);
    e->DeleteWeakGlobalRef(s->view);
    sides().erase(id);
  });

  return {view, side->node};
}

FlexChild leaf(const NativeRef& view) {
  auto node = LayoutNode::create();
  JNIEnv* env = jni::env();
  const jweak weak = env->NewWeakGlobalRef(jni::unwrap(view));
  std::shared_ptr<void> held(weak, [](void* w) { jni::env()->DeleteWeakGlobalRef(static_cast<jweak>(w)); });

  node->measureWith([held](float width, MeasureMode wm, float height, MeasureMode hm) {
    JNIEnv* e = jni::env();
    jobject v = e->NewLocalRef(static_cast<jweak>(held.get()));
    if (!v) return LayoutSize{0, 0};

    static const jclass cls = jni::findClass("android/view/View");
    static const jmethodID measure = jni::method(cls, "measure", "(II)V");
    static const jmethodID measuredWidth = jni::method(cls, "getMeasuredWidth", "()I");
    static const jmethodID measuredHeight = jni::method(cls, "getMeasuredHeight", "()I");
    static const jmethodID resources = jni::method(cls, "getResources", "()Landroid/content/res/Resources;");
    static const jmethodID metrics =
        jni::method(jni::findClass("android/content/res/Resources"), "getDisplayMetrics", "()Landroid/util/DisplayMetrics;");
    static const jfieldID densityField = jni::field(jni::findClass("android/util/DisplayMetrics"), "density", "F");

    jobject res = e->CallObjectMethod(v, resources);
    jobject display = e->CallObjectMethod(res, metrics);
    const float density = e->GetFloatField(display, densityField);
    e->DeleteLocalRef(display);
    e->DeleteLocalRef(res);

    e->CallVoidMethod(v, measure, specOf(width, wm, density), specOf(height, hm, density));
    jni::check(e);
    const LayoutSize size{static_cast<float>(e->CallIntMethod(v, measuredWidth)) / density,
                          static_cast<float>(e->CallIntMethod(v, measuredHeight)) / density};
    e->DeleteLocalRef(v);
    return size;
  });

  return {view, node};
}

ChildOps<FlexChild> ops(const FlexChild& parent) {
  const auto node = parent.node;

  return {
      [node](const FlexChild& child, int index) {
        auto side = sideOf(node);
        JNIEnv* env = jni::env();
        static const jmethodID add = jni::method(jni::findClass("android/view/ViewGroup"), "addView", "(Landroid/view/View;I)V");

        side->node->insert(child.node, static_cast<size_t>(index));
        side->children.insert(side->children.begin() + index, child);
        if (jobject v = env->NewLocalRef(side->view)) {
          env->CallVoidMethod(v, add, jni::unwrap(child.view), index);
          env->DeleteLocalRef(v);
          jni::check(env);
        }
      },
      [node](const FlexChild& child) {
        auto side = sideOf(node);
        JNIEnv* env = jni::env();
        static const jmethodID remove = jni::method(jni::findClass("android/view/ViewGroup"), "removeView", "(Landroid/view/View;)V");

        auto at = std::find_if(side->children.begin(), side->children.end(),
                               [&](const FlexChild& c) { return c.node == child.node; });
        if (at == side->children.end()) return;

        side->node->remove(child.node);
        if (jobject v = env->NewLocalRef(side->view)) {
          env->CallVoidMethod(v, remove, jni::unwrap(child.view));
          env->DeleteLocalRef(v);
          jni::check(env);
        }
        side->children.erase(at);
      },
      nullptr,
  };
}

}  // namespace lucent::ui::flex

#endif
