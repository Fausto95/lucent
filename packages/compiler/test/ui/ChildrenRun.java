// React children in the Android host's rules (dev.lucent.LucentChildren),
// on the JVM over plain views: React Native adds children before the
// view's mount, then moves (removes and adds), adds and removes them; the
// view is recycled and mounted again; a slot its setup leaves out; children
// given to a component taking none. Prints one line per step;
// android-children.test.ts compares them.
package dev.lucent;

import java.util.ArrayList;
import java.util.List;

final class ChildrenRun {
  /** A view: a tag, its parent, its children in z-order. A slot's tag is above 100. */
  static final class View {
    final int tag;
    View parent;
    final List<View> children = new ArrayList<>();

    View(int tag) {
      this.tag = tag;
    }
  }

  private static int slots = 100;
  private static final List<String> reports = new ArrayList<>();

  private static final LucentChildren.Slots<View, View> VIEWS =
      new LucentChildren.Slots<>() {
        @Override
        public View make() {
          return new View(++slots);
        }

        @Override
        public View slotOf(View child) {
          return child.parent != null && child.parent.tag > 100 ? child.parent : null;
        }

        @Override
        public boolean hasParent(View child) {
          return child.parent != null;
        }

        @Override
        public void insert(View slot, View child, View next) {
          slot.children.add(next == null ? slot.children.size() : slot.children.indexOf(next), child);
          child.parent = slot;
        }

        @Override
        public void remove(View slot, View child) {
          slot.children.remove(child);
          child.parent = null;
        }

        @Override
        public boolean within(View slot, View content) {
          for (View v = slot; v != null; v = v.parent) if (v == content) return true;

          return false;
        }
      };

  private static void say(String line) {
    System.out.println(line);
  }

  private static String tags(View view) {
    if (view == null) return "no slot";

    StringBuilder out = new StringBuilder();

    for (View v : view.children) out.append(out.length() == 0 ? "" : " ").append(v.tag);

    return out.length() == 0 ? "nothing" : out.toString();
  }

  private static String where(View view) {
    return view.parent == null ? "in none" : "in " + view.parent.tag;
  }

  /** What React Native sees: the children it added, through the manager. */
  private static String seen(LucentChildren<View, View> children) {
    StringBuilder out = new StringBuilder();

    for (int i = 0; i < children.count(); i++) out.append(i == 0 ? "" : " ").append(children.childAt(i).tag);

    return out.toString();
  }

  public static void main(String[] args) {
    LucentChildren<View, View> card = new LucentChildren<>(VIEWS, "Card", true, reports::add);
    View a = new View(11);
    View b = new View(12);

    // Children first: React Native adds a new view's children before it attaches the view.
    card.add(a, 0);
    card.add(b, 1);
    say("before mount: 11 " + where(a) + ", 12 " + where(b) + ", React Native sees " + seen(card));

    View slot = card.startMount();
    View content = new View(1);

    VIEWS.insert(content, slot, null);
    card.mountedContent(content);
    say("mounted: slot holds " + tags(slot));

    // A move is a removal and an addition.
    card.remove(1);
    card.add(b, 0);
    say("reordered: " + tags(slot) + ", React Native sees " + seen(card));

    View c = new View(13);

    card.add(c, 1);
    card.remove(2);
    say("added, removed: " + tags(slot) + ", 11 " + where(a));

    // Unmounted: React Native removes the children first, then recycles the view.
    card.remove(0);
    card.remove(0);
    card.endMount();
    say("recycled: slot " + (card.slot() == null ? "none" : "kept") + ", old slot holds " + tags(slot));

    View d = new View(14);

    card.add(d, 0);
    View again = card.startMount();
    say("remounted: " + (again == slot ? "same" : "new") + " slot holds " + tags(again));

    // A slot its setup never put in its view: reported, the children kept in it.
    LucentChildren<View, View> pocket = new LucentChildren<>(VIEWS, "Pocket", true, reports::add);
    View e = new View(15);

    pocket.add(e, 0);
    pocket.mountedContent(new View(2));
    View pocketSlot = pocket.startMount();
    pocket.mountedContent(new View(3));
    say("pocket: slot holds " + tags(pocketSlot));

    // Children given to a component taking none: reported, placed nowhere.
    LucentChildren<View, View> label = new LucentChildren<>(VIEWS, "Label", false, reports::add);
    View f = new View(16);

    label.add(f, 0);
    say("label: 16 " + where(f) + ", " + tags(label.startMount()) + ", React Native sees " + seen(label));

    label.remove(0);
    say("label: 16 removed, React Native sees " + label.count());

    for (String report : reports) say("reported: " + report);
  }
}
