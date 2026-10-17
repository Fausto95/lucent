import { type View, ViewGroup } from "lucent:android/android.view";
import { QXNGauge, QXNPanel, QXNReading } from "lucent:android/dev.qxn.panels";
import { slot } from "lucent:ui";
import type { Props } from "./meter.lucent";

export function QXNMeter(props: Props): View {
  const content = slot<ViewGroup>();

  return (
    <QXNPanel>
      <QXNGauge
        qxnReading={new QXNReading(props.qxnScale.qxnFrom, props.qxnLabels[0] ?? "")}
        qxnMarks={props.qxnScale.qxnMarks}
        qxnLabel={props.qxnMode ?? "qxnFine"}
        onQXNTurn={(reading, steps) =>
          props.onQxnTurned?.({
            qxnLevel: reading?.getQxnLevel() ?? 0,
            qxnLabel: reading?.getQxnLabel() ?? "",
            qxnSteps: steps,
          })
        }
      />
      <ViewGroup create={() => content} />
    </QXNPanel>
  );
}
