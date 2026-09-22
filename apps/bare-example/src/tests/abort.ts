// Generated from packages/compiler/test/e2e/cases/abort.test.js. Do not edit.
// @ts-nocheck
export default function run(mod, print, lucentClass, mods) {
  (async () => {
    const c1 = new AbortController();
    const p1 = mod.waitOrStop(1000, c1.signal);
    setTimeout(() => c1.abort(), 20);
    print(await p1);
    print(await mod.waitOrStop(5, new AbortController().signal));
    const done = new AbortController();
    done.abort();
    print(await mod.waitOrStop(5, done.signal));
    print(mod.check(done.signal), mod.check(new AbortController().signal));
    print(mod.checkOptional(), mod.checkOptional(done.signal));
    const c2 = new AbortController();
    const p2 = mod.tickUntilAborted(c2.signal);
    setTimeout(() => c2.abort(), 30);
    print(await p2);
    print(await mod.tickUntilAborted(done.signal));
    print(await mod.controllerInLucent());
    print(await mod.customReason());
    const c3 = new AbortController();
    const p3 = mod.abortedMidway(c3.signal);
    setTimeout(() => c3.abort(new Error("from js")), 10);
    print(await p3);
    try {
      mod.check({ aborted: false });
    } catch (e) {
      print("not a signal:", e.name);
    }
  })();

}
