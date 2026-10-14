/**
 * Components whose Android root is a Fragment (T131): the setup returns a
 * Fragment, which the host commits to the Activity's FragmentManager over
 * a container in the component's shell (LucentFragments.java), so the
 * mount gives the host the fragment and no view, and the library builds
 * the runtime's host of fragments. Compiled against stand-ins for
 * android.jar and androidx.fragment.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, deferredLibraryGradle, libraryBuildGradle, runtimeDir } from "../../src/index.ts";
import { fakeAndroid } from "../fake-android.ts";

const STAND_INS = {
  "android/content/Context.java": `package android.content;
public abstract class Context {}
`,
  "android/os/Bundle.java": `package android.os;
public final class Bundle {
  public Bundle() {}
  public String getString(String key) { return null; }
  public void putString(String key, String value) {}
}
`,
  "android/view/View.java": `package android.view;
public class View { public View(android.content.Context c) {} }
`,
  "android/view/ViewGroup.java": `package android.view;
public abstract class ViewGroup extends View { public ViewGroup(android.content.Context c) { super(c); } }
`,
  "android/view/LayoutInflater.java": `package android.view;
public abstract class LayoutInflater {}
`,
  "android/widget/TextView.java": `package android.widget;
public class TextView extends android.view.View {
  public TextView(android.content.Context c) { super(c); }
  public void setText(CharSequence s) {}
}
`,
  "androidx/fragment/app/Fragment.java": `package androidx.fragment.app;
public class Fragment {
  public Fragment() {}
  public final android.content.Context requireContext() { return null; }
  public final android.os.Bundle getArguments() { return null; }
  public void setArguments(android.os.Bundle b) {}
  public final android.view.View getView() { return null; }
  public android.view.View onCreateView(android.view.LayoutInflater i, android.view.ViewGroup c, android.os.Bundle s) { return null; }
}
`,
};

const FILES = {
  "card.lucent.ts": `import type { Fragment } from "lucent:android/androidx.fragment.app";

export declare function Card(props: { text: string }): Fragment;
`,
  "card.android.lucent.tsx": `import { Bundle } from "lucent:android/android.os";
import type { LayoutInflater, View, ViewGroup } from "lucent:android/android.view";
import { TextView } from "lucent:android/android.widget";
import { Fragment } from "lucent:android/androidx.fragment.app";
import { effect } from "lucent:ui";

export class CardFragment extends Fragment {
  onCreateView(_inflater: LayoutInflater, _container: ViewGroup | null, _saved: Bundle | null): View | null {
    const label = new TextView(this.requireContext());
    label.setText(this.getArguments()?.getString("text") ?? "");
    return label;
  }
}

function cardFragment(): Fragment {
  const card = new CardFragment();
  card.setArguments(new Bundle());
  return card;
}

function retitle(card: Fragment, text: string): void {
  card.getArguments()?.putString("text", text);
  const view = card.getView();
  if (view instanceof TextView) view.setText(text);
}

export function Card(props: { text: string }): Fragment {
  const card = cardFragment();
  effect(() => retitle(card, props.text));
  return card;
}
`,
};

function compiled() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-fragment-roots-"));
  const android = fakeAndroid(dir, STAND_INS);

  if (!android) return undefined;

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  for (const [name, text] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, name), text);

  return compile(
    Object.keys(FILES).map((f) => path.join(dir, f)),
    { platforms: ["android"], sdk: { android: { jars: android.bind } } },
  );
}

const result = compiled();

describe.skipIf(!result)("a component whose Android root is a Fragment", () => {
  it("gives its host the fragment, and no view", () => {
    expect(result!.diagnostics.map((d) => d.message)).toEqual([]);

    const glue = [...result!.files].find(([f]) => /views\/.*_android\.cpp$/.test(f))?.[1] ?? "";

    expect(glue).toMatch(
      /lucent::NativeRef fragment\(\) const override \{\s*return mount_->view\(\);/,
    );
    expect(glue).toMatch(/lucent::NativeRef view\(\) const override \{\s*return \{\};/);
    expect(result!.fragments).toBe(true);
  });

  it("has the library build the runtime's host of fragments, against the app's androidx.fragment", () => {
    const template = fs.readFileSync(
      path.join(runtimeDir(), "native/android/build.gradle"),
      "utf8",
    );
    const gradle = libraryBuildGradle(template, undefined, false, [], true);

    expect(gradle).toContain('sourceSets.main.java.srcDirs += "src/fragment/java"');
    expect(gradle).toContain('compileOnly("androidx.fragment:fragment:1.3.6")');
    expect(libraryBuildGradle(template, undefined)).not.toContain("src/fragment/java");
  });

  it("is built by a deferred Android build, which can't know whether a component has one", () => {
    // After expo prebuild, which compiled no platform, the first Gradle build configures the
    // library before it builds Android.
    for (const components of [false, true])
      expect(deferredLibraryGradle(undefined, components)).toContain(
        'sourceSets.main.java.srcDirs += "src/fragment/java"',
      );
  });
});
