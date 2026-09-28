import { delay } from "lucent:core";
import { Timer } from "lucent:ios/Foundation";
import { UIColor, UIFont, UIFont_TextStyle, UIImage, UIImageView, UILabel } from "lucent:ios/UIKit";
import { effect, expose, invalidateSize, native } from "lucent:ui";

// A 96x48 blue PNG: at scale 1, a 96x48 point image.
function png(): Uint8Array {
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 96, 0, 0, 0, 48, 8, 2, 0,
    0, 0, 97, 116, 232, 152, 0, 0, 0, 86, 73, 68, 65, 84, 120, 218, 237, 208, 65, 9, 0, 0, 8, 4,
    176, 171, 98, 105, 139, 90, 192, 6, 254, 133, 193, 18, 44, 213, 195, 33, 10, 4, 9, 18, 36, 72,
    144, 32, 65, 130, 16, 36, 72, 144, 32, 65, 130, 4, 9, 66, 144, 32, 65, 130, 4, 9, 18, 36, 8, 65,
    130, 4, 9, 18, 36, 72, 144, 32, 65, 8, 18, 36, 72, 144, 32, 65, 130, 4, 33, 72, 144, 32, 65,
    130, 126, 88, 225, 53, 245, 180, 244, 177, 43, 3, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);
}

export function Blurb(props: { text: string }): UILabel {
  const label = native(() => new UILabel());

  // Wraps within the width its layout gives it, at the text size the user chose.
  label.numberOfLines = 0n;
  label.backgroundColor = UIColor.systemYellow;
  label.font = UIFont.preferredFont(UIFont_TextStyle.body);
  label.adjustsFontForContentSizeCategory = true;

  effect(() => {
    label.text = props.text;
  });

  expose({
    append: (more: string) => {
      label.text = `${label.text ?? ""}${more}`;
    },
    // A change no commit or command announces: a native timer's, 200 ms later.
    appendLater: (more: string) => {
      Timer.scheduledTimer(0.2, false, () => {
        label.text = `${label.text ?? ""}${more}`;
      });
    },
  });

  return label;
}

export function Picture(_props: { name: string }): UIImageView {
  const view = native(() => new UIImageView(null));

  view.backgroundColor = UIColor.systemGreen;

  expose({
    // The image arrives after an await: no function setup made runs then.
    load: async (announce: boolean) => {
      await delay(300);
      view.image = new UIImage(png());

      if (announce) invalidateSize();
    },
  });

  return view;
}
