import { appContext } from "lucent:android";
import { GradientDrawable } from "lucent:android/android.graphics.drawable";
import { Handler, Looper } from "lucent:android/android.os";
import { ImageView, TextView } from "lucent:android/android.widget";
import { delay } from "lucent:core";
import { effect, expose, invalidateSize, native } from "lucent:ui";

export function Blurb(props: { text: string }): TextView {
  const label = native(() => new TextView(appContext()));

  // Yellow (ARGB), as on iOS.
  label.setBackgroundColor(0xffffeb3b | 0);

  effect(() => {
    label.setText(props.text);
  });

  expose({
    append: (more: string) => {
      label.append(more);
    },
    // A change no commit or command announces: a native timer's, 200 ms later.
    appendLater: (more: string) => {
      const looper = Looper.getMainLooper();

      if (looper) new Handler(looper).postDelayed(() => label.append(more), 200n);
    },
  });

  return label;
}

export function Picture(_props: { name: string }): ImageView {
  const view = native(() => new ImageView(appContext()));

  view.setBackgroundColor(0xff4caf50 | 0);

  expose({
    // The image arrives after an await: no function setup made runs then.
    load: async (announce: boolean) => {
      await delay(300);

      const image = new GradientDrawable();

      image.setColor(0xff2196f3 | 0);
      // 96x48 dp at the emulator's 2.75 pixels per dp.
      image.setSize(264, 132);
      view.setImageDrawable(image);

      if (announce) invalidateSize();
    },
  });

  return view;
}
