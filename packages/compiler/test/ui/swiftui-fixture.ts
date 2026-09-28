/**
 * A SwiftUI component written in Lucent: a toggle (a capsule whose knob
 * moves with a spring when it flips) above a text counting its taps. Its
 * body is the function it gives `swiftUI`, in call form. A tap calls the
 * setup's `flip`, which flips a signal and sends `onChange`; its `pulse()`
 * command scales it with `withAnimation`; the text shows a prop and a
 * signal.
 */

export const TOGGLE = {
  "toggle.lucent.ts": `import type { UIHostingController } from "lucent:swiftui";

export type Props = {
  title: string;
  onChange?: (on: boolean, taps: number) => void;
};

export declare function Toggle(props: Props): UIHostingController;
`,
  "toggle.ios.lucent.tsx": `import {
  Alignment,
  Animation,
  Capsule,
  Circle,
  Color,
  swiftUI,
  Text,
  type UIHostingController,
  VStack,
  withAnimation,
  ZStack,
} from "lucent:swiftui";
import { expose, signal } from "lucent:ui";
import type { Props } from "./toggle.lucent";

export function Toggle(props: Props): UIHostingController {
  const on = signal(false);
  const taps = signal(0);
  const scale = signal(1);

  const flip = () => {
    on.set(!on.peek());
    taps.set(taps.peek() + 1);
    props.onChange?.(on.peek(), taps.peek());
  };

  expose({
    toggle: () => flip(),
    pulse: () => {
      withAnimation(Animation.spring({ response: 0.25, dampingFraction: 0.4 }), () => {
        scale.set(1.3);
      });
    },
    state: (): string => \`\${on.peek() ? "on" : "off"} \${taps.peek()}\`,
  });

  return swiftUI(() =>
    VStack({ spacing: 8 }, [
      ZStack({ alignment: on.get() ? Alignment.trailing : Alignment.leading }, [
        Capsule().fill(on.get() ? Color.green : Color.gray),
        Circle().fill(Color.white).padding(3),
      ])
        .frame({ width: 56, height: 32 })
        .scaleEffect(scale.get())
        .animation(Animation.spring({ response: 0.35, dampingFraction: 0.6 }), { value: on.get() })
        .onTapGesture(() => flip()),
      on.get() ? Text("on") : Circle().fill(Color.red).frame({ width: 8, height: 8 }),
      Text(\`\${props.title}: \${taps.get()} taps\`),
    ]),
  );
}
`,
};

/**
 * A wider slice of SwiftUI in one component: stacks, text, an image, a
 * button, a spacer; padding, background, overlay, font, foregroundStyle,
 * opacity, scaleEffect, rotationEffect, offset; animations with a spring
 * and easeInOut, and withAnimation in a command.
 */
export const GALLERY = {
  "gallery.lucent.ts": `import type { UIHostingController } from "lucent:swiftui";

export type Props = { title: string };

export declare function Gallery(props: Props): UIHostingController;
`,
  "gallery.ios.lucent.tsx": `import {
  Alignment,
  Angle,
  Animation,
  Button,
  Color,
  Edge,
  Font,
  HorizontalAlignment,
  HStack,
  Image,
  Spacer,
  swiftUI,
  Text,
  type UIHostingController,
  VStack,
  withAnimation,
} from "lucent:swiftui";
import { expose, signal } from "lucent:ui";
import type { Props } from "./gallery.lucent";

export function Gallery(props: Props): UIHostingController {
  const liked = signal(false);
  const angle = signal(0);
  const taps = signal(0);

  const like = () => {
    liked.set(!liked.peek());
    taps.set(taps.peek() + 1);
  };

  expose({
    spin: () => {
      withAnimation(Animation.easeInOut({ duration: 0.4 }), () => {
        angle.set(angle.peek() + 90);
      });
    },
  });

  return swiftUI(() =>
    VStack({ alignment: HorizontalAlignment.leading, spacing: 12 }, [
      HStack([
        Image({ systemName: "star.fill" })
          .foregroundStyle(liked.get() ? Color.yellow : Color.gray)
          .rotationEffect(Angle.degrees(angle.get()))
          .scaleEffect(liked.get() ? 1.2 : 1)
          .animation(Animation.spring({ response: 0.3, dampingFraction: 0.5 }), { value: liked.get() }),
        Spacer(),
        Text(props.title).font(Font.headline).opacity(liked.get() ? 1 : 0.6),
      ]),
      Button("Like", () => like())
        .padding(Edge.Set.horizontal, 16)
        .padding(8)
        .background(Color.blue.opacity(0.15))
        .overlay({ alignment: Alignment.topTrailing }, [Text(\`\${taps.get()}\`).font(Font.caption)])
        .offset({ x: 0, y: 4 })
        .animation(Animation.easeInOut({ duration: 0.2 }), { value: taps.get() }),
    ]).padding(),
  );
}
`,
};
