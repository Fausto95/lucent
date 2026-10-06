// Lucent runtime — the Android view tree a debug build's snapshot shows
// (T61, view.h debugSnapshot): each view's class, frame (density-
// independent pixels, in its parent) and children, ones not visible
// marked. The host installs it.
#if defined(__ANDROID__) || defined(LUCENT_JNI_HOST)

#include <cstdio>
#include <string>

#include "../view.h"
#include "android.h"

namespace lucent::jni {

namespace {

std::string number(double v) {
  char out[32];
  std::snprintf(out, sizeof out, "%g", v);
  return out;
}

struct Methods {
  jclass view = findClass("android/view/View");
  jclass group = findClass("android/view/ViewGroup");
  jmethodID getClass = method(findClass("java/lang/Object"), "getClass", "()Ljava/lang/Class;");
  jmethodID getName = method(findClass("java/lang/Class"), "getName", "()Ljava/lang/String;");
  jmethodID left = method(view, "getLeft", "()I");
  jmethodID top = method(view, "getTop", "()I");
  jmethodID width = method(view, "getWidth", "()I");
  jmethodID height = method(view, "getHeight", "()I");
  jmethodID visibility = method(view, "getVisibility", "()I");
  jmethodID resources = method(view, "getResources", "()Landroid/content/res/Resources;");
  jmethodID metrics =
      method(findClass("android/content/res/Resources"), "getDisplayMetrics", "()Landroid/util/DisplayMetrics;");
  jfieldID density = field(findClass("android/util/DisplayMetrics"), "density", "F");
  jmethodID count = method(group, "getChildCount", "()I");
  jmethodID childAt = method(group, "getChildAt", "(I)Landroid/view/View;");
};

const Methods& methods() {
  static const Methods m;
  return m;
}

void write(JNIEnv* env, std::string& out, jobject view, float density) {
  const Methods& m = methods();

  jobject cls = env->CallObjectMethod(view, m.getClass);
  auto name = static_cast<jstring>(env->CallObjectMethod(cls, m.getName));
  check(env);
  const char* chars = env->GetStringUTFChars(name, nullptr);
  out += "{\"class\":\"";
  out += chars;
  env->ReleaseStringUTFChars(name, chars);
  env->DeleteLocalRef(name);
  env->DeleteLocalRef(cls);

  const auto dp = [&](jmethodID get) { return number(env->CallIntMethod(view, get) / density); };
  out += "\",\"frame\":[" + dp(m.left) + "," + dp(m.top) + "," + dp(m.width) + "," + dp(m.height) + "]";
  // View.VISIBLE is 0.
  if (env->CallIntMethod(view, m.visibility) != 0) out += ",\"hidden\":true";
  check(env);

  if (env->IsInstanceOf(view, m.group)) {
    const jint n = env->CallIntMethod(view, m.count);
    if (n > 0) {
      out += ",\"children\":[";
      for (jint i = 0; i < n; i++) {
        jobject child = env->CallObjectMethod(view, m.childAt, i);
        check(env);
        if (i) out += ",";
        write(env, out, child, density);
        env->DeleteLocalRef(child);
      }
      out += "]";
    }
  }

  out += "}";
}

}  // namespace

void installViewTree() {
  ui::setViewTree([](const NativeRef& ref) {
    JNIEnv* env = jni::env();
    const Methods& m = methods();
    jobject view = unwrap(ref);

    jobject res = env->CallObjectMethod(view, m.resources);
    jobject display = env->CallObjectMethod(res, m.metrics);
    check(env);
    const float density = env->GetFloatField(display, m.density);
    env->DeleteLocalRef(display);
    env->DeleteLocalRef(res);

    std::string out;
    write(env, out, view, density > 0 ? density : 1);
    return out;
  });
}

}  // namespace lucent::jni

#endif
