// A mount's requests, run: the Ticket fixture's asynchronous commands on
// Mac Catalyst (requests_run_test.mm drives them as a host would). Each
// request is answered once: with its result, with its error, or, still
// unanswered when the mount ends, rejected then. What answers later is
// dropped, and nothing of the mount's routes stays behind.
import { describe, expect, it } from "vite-plus/test";
import { canRunMounted, runMounted } from "./mount-harness.ts";

const TICKET = {
  "ticket.lucent.ts": `import type { UILabel } from "lucent:ios/UIKit";
import type { TextView } from "lucent:android/android.widget";

export type Props = { title: string; onIssued?: (n: number) => void };

export declare function Ticket(props: Props): UILabel | TextView;
`,
  "ticket.ios.lucent.tsx": `import { delay } from "lucent:core";
import { UILabel } from "lucent:ios/UIKit";
import { effect, expose } from "lucent:ui";
import type { Props } from "./ticket.lucent";

export function Ticket(props: Props): UILabel {
  const label = new UILabel();
  let issued = 0;

  effect(() => {
    label.text = props.title;
  });

  expose({
    // Answers after \`ms\` milliseconds: after the mount ends, if it ends first.
    issue: async (ms: number): Promise<number> => {
      await delay(ms);
      issued++;
      label.text = \`ticket \${issued}\`;
      props.onIssued?.(issued);
      return issued;
    },
    fail: async (): Promise<number> => {
      await delay(0);
      throw new Error("no tickets left");
    },
  });

  return label;
}
`,
};

/** Every step of the driver, in order. */
const EXPECTED = [
  "answered: 2 = 1, 1 = 2, events [1,2]",
  "failed: 3 no tickets left",
  "pending: 3 answers, respond held",
  "unmounted: 4 Ticket unmounted before answering",
  "late: 4 answers, events [1,2], label ticket 3",
  "released: respond, emit, view",
];

describe("a mount's requests", () => {
  it.skipIf(!canRunMounted)(
    "are answered once, rejected when the mount ends first, and leave nothing behind",
    () => {
      expect(runMounted(TICKET, "requests_run_test.mm")).toEqual(EXPECTED);
    },
    600_000,
  );
});
