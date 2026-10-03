// The app's Android code using the library by its names alone: Lucent binds
// it by rule, with nothing about it in Lucent.
import type { QXNUnit } from "lucent:android/dev.qxn.core";
import { QXNBase, QXNBox, QXNGauge, type QXNListener } from "lucent:android/dev.qxn.kit";

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

  return `${base.qxnDescribe()} | ${recorder.levels.join(" ")} | ${boxed} ${labels} | ${formatted} | ${failed}`;
}
