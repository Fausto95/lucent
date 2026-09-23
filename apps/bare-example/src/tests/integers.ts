// Generated from packages/compiler/test/e2e/cases/integers.test.js. Do not edit.
// @ts-nocheck
export default function run(mod, print, lucentClass, mods) {
  print(mod.wraparound());
  print(mod.shifts(-12345, 3), mod.shifts(0x7fffffff, 33), mod.shifts(1, 31), mod.shifts(-1, 0), mod.shifts(3.9, 1));
  print(mod.mixed(5), mod.mixed(-7), mod.mixed(2.5), mod.mixed(4294967301));
  print(mod.signedZero());
  print(mod.counters());
  print(mod.unsignedAccumulate(0), mod.unsignedAccumulate(1000));
  print(mod.destructured({ z: 1.5 }, []), mod.destructured({ z: -0.25 }, [0.5]));

}
