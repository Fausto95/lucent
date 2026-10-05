// The app's iOS code using the library by its names alone: Lucent binds it by
// rule, with nothing about it in Lucent.
import type { QXNUnit } from "lucent:ios/QXNCore";
import { QXNBase, QXNBox, QXNGauge, type QXNListener } from "lucent:ios/QXNKit";

class Recorder implements QXNListener {
  levels: number[] = [];

  qxnChanged(level: number): void {
    this.levels.push(level);
  }
}

export async function run(): Promise<string> {
  const gauge = new QXNGauge("g", 2);
  const base: QXNBase = gauge;
  const recorder = new Recorder();

  gauge.qxnListener = recorder;
  gauge.qxnBump(1);
  gauge.qxnBump(0.5);

  const boxed = new QXNBox<QXNGauge>(gauge).qxnItem.qxnLevel;
  const labels = new QXNBox<string>("box").qxnItem;

  // Functions both ways: one stored (called later, on this thread), one passed, one returned.
  const other = new QXNGauge("f", 1);
  const shifts: number[] = [];
  other.qxnOnShift = (level) => {
    shifts.push(level);
  };
  other.qxnShift(2);
  const each = other.qxnEach([1, 2], (step, label) => `${label}${step * 10}`);
  const watch = other.qxnWatcher();

  // Tuples, as arrays: one returned, one passed and returned labeled.
  const [low, high] = other.qxnRange();
  const [clamped, label] = other.qxnClamp([0, 2]);

  const measured = await gauge.qxnMeasure();
  let failed = "no";
  try {
    await new QXNGauge("n", -1).qxnMeasure();
  } catch (e) {
    failed = (e as Error).name;
  }
  // The dependency's type: its members, once its module is imported too.
  const unit: QXNUnit = gauge.qxnUnit();
  const formatted = unit.qxnFormat(measured);

  other.qxnOnShift = null;

  return `${base.qxnDescribe()} | ${recorder.levels.join(" ")} | ${boxed} ${labels} | ${formatted} | ${failed} | ${shifts.join(" ")} ${each.join(" ")} ${watch()} | ${low} ${high} ${clamped} ${label}`;
}
