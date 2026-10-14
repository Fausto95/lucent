// A Fragment written in Lucent. Exported and extending an Android class,
// it is one the OS makes by its name (decision 0097):
// dev.lucent.app.lucent_fragment.panel.Panel, with the public constructor
// without arguments a FragmentManager calls when it restores a fragment.
// Its lifecycle methods run while Android waits, and call the base's
// through super, as Android requires (decision 0103). JavaScript never
// sees the class, so panel.lucent.ts doesn't declare it.
import { currentActivity } from "lucent:android";
import { Bundle } from "lucent:android/android.os";
import { type LayoutInflater, View, ViewGroup } from "lucent:android/android.view";
import { FrameLayout, TextView } from "lucent:android/android.widget";
import { Fragment, FragmentActivity } from "lucent:android/androidx.fragment.app";
import { main } from "lucent:thread";

/** The back stack entry the panel is shown in, and saved and restored with. */
const STACK = "lucent-panel";

/** What the state the panel saves holds. */
const KEPT = "kept";

let made = 0;
let views = 0;
let restored = "";

export class Panel extends Fragment {
  constructor() {
    super();
    made++;
  }

  onCreate(saved: Bundle | null): void {
    super.onCreate(saved);
    if (saved) restored = saved.getString("panel") ?? "nothing";
  }

  onCreateView(
    _inflater: LayoutInflater,
    _container: ViewGroup | null,
    _saved: Bundle | null,
  ): View | null {
    views++;
    const text = new TextView(this.requireContext());
    text.setText("A Fragment written in Lucent");
    return text;
  }

  onSaveInstanceState(out: Bundle): void {
    super.onSaveInstanceState(out);
    out.putString("panel", KEPT);
  }
}

export async function showAndRestore(): Promise<string> {
  return main(() => {
    const activity = currentActivity();
    const decor = activity?.getWindow()?.getDecorView();
    if (!(activity instanceof FragmentActivity) || !(decor instanceof ViewGroup))
      return "no FragmentActivity";

    // A container over the Activity's content, for the time the probe runs.
    const frame = new FrameLayout(activity);
    frame.setId(View.generateViewId());
    decor.addView(frame);

    const before = { made, views };
    restored = "";
    const manager = activity.getSupportFragmentManager();
    manager
      .beginTransaction()
      .setReorderingAllowed(true)
      .add(frame.getId(), new Panel(), STACK)
      .addToBackStack(STACK)
      .commit();
    manager.executePendingTransactions();

    // Saved as the Activity's recreation saves it: the panel goes, and its state is kept.
    manager.saveBackStack(STACK);
    manager.executePendingTransactions();
    // Made again by its name, with that state.
    manager.restoreBackStack(STACK);
    manager.executePendingTransactions();
    const shown = manager.findFragmentByTag(STACK) !== null;

    manager.popBackStackImmediate();
    decor.removeView(frame);

    return `made ${made - before.made}, views ${views - before.views}, restored ${restored || "nothing"}${shown ? "" : ", not shown"}`;
  });
}
