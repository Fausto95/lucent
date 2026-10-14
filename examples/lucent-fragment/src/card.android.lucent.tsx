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
import type { LayoutInflater, View, ViewGroup } from "lucent:android/android.view";
import { TextView } from "lucent:android/android.widget";
import { Fragment } from "lucent:android/androidx.fragment.app";
import { main } from "lucent:thread";
import { effect } from "lucent:ui";
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

export function Card(props: CardProps): Fragment {
  const card = cardFragment();
  effect(() => retitle(card, props.text));
  return card;
}

export async function cardShown(): Promise<string> {
  return main(() => {
    const view = shownView;
    if (!view) return "no view";
    if (!view.isAttachedToWindow()) return "not in a window";
    return view.getWidth() > 0 && view.getHeight() > 0 ? "shown" : "not laid out";
  });
}
