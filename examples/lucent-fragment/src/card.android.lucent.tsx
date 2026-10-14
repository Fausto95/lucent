// A component whose Android root is a Fragment (T131). Card's setup
// returns one, which the host commits to the Activity's FragmentManager
// over a container in the component's view once that view is in a window,
// and takes out when React unmounts the component. The fragment is a
// CardFragment, a Lucent class made in module code (cardFragment): like
// any Lucent object Android calls, its methods run in module code. Its
// text is in its arguments, which Android keeps when it makes it again,
// and an effect sets it as the prop changes. Exported and extending
// Fragment, the class is one the OS can make by its name (decision 0097).
import { Bundle } from "lucent:android/android.os";
import { type LayoutInflater, type View, ViewGroup } from "lucent:android/android.view";
import { TextView } from "lucent:android/android.widget";
import { Fragment } from "lucent:android/androidx.fragment.app";
import { currentActivity } from "lucent:android";
import { main } from "lucent:thread";
import type { CardProps } from "./card.lucent";

/** The argument holding the card's text. */
const TEXT = "text";

/** The view of the card shown last, which cardShown() looks at. */
let shownView: View | null = null;

export class CardFragment extends Fragment {
  onCreateView(
    _inflater: LayoutInflater,
    _container: ViewGroup | null,
    _saved: Bundle | null,
  ): View | null {
    const label = new TextView(this.requireContext());
    label.setText(this.getArguments()?.getString(TEXT) ?? "");
    return label;
  }

  onViewCreated(view: View, saved: Bundle | null): void {
    super.onViewCreated(view, saved);
    shownView = view;
  }
}

/** A card's fragment, made in module code. */
function cardFragment(): Fragment {
  const card = new CardFragment();
  card.setArguments(new Bundle());
  return card;
}

/** Sets a card's text: in its arguments, and in its view once Android made it. */
function retitle(card: Fragment, text: string): void {
  card.getArguments()?.putString(TEXT, text);
  const view = card.getView();
  if (view instanceof TextView) view.setText(text);
}

// EXPERIMENT: a plain TextView root, to see whether the flake needs a fragment.
export function Card(props: CardProps): View {
  return <TextView text={props.text} />;
}

export async function cardShown(): Promise<string> {
  return main(() => {
    // EXPERIMENT: the card's TextView, found by its text in the window.
    const root = currentActivity()?.getWindow()?.getDecorView();
    const views: View[] = root ? [root] : [];
    let view: View | null = null;
    while (views.length && !view) {
      const at = views.pop()!;
      if (at instanceof TextView && at.getText() === "A Fragment, as a component's root") view = at;
      if (at instanceof ViewGroup)
        for (let i = 0; i < at.getChildCount(); i++) {
          const child = at.getChildAt(i);
          if (child) views.push(child);
        }
    }
    if (!view) return "no view";
    if (view.getWidth() > 0 && view.getHeight() > 0) return "shown";
    const sizes: string[] = [];
    let up: View | null = view;
    for (let i = 0; up && i < 3; i++) {
      sizes.push(`${up.getWidth()}x${up.getHeight()}`);
      const parent = up.getParent();
      up = parent instanceof ViewGroup ? parent : null;
    }
    return `not laid out: ${sizes.join(" in ")}`;
  });
}
