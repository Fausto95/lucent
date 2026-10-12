"use strict";
// lucent:thread in JS dev mode: JavaScript has one thread, so main() runs
// its function on it, later, as the native main() runs it on the main
// thread and settles the promise with its result or its error. An
// executor is its label, and on() hands its function over as it is: the
// platform APIs that would run it on the executor are native.
class Executor {
  constructor(label) {
    this.label = label;
  }
  execute() {
    throw new TypeError(
      "an executor's execute() is for the platform: hand it a function with on(executor, f)",
    );
  }
}

module.exports = {
  main: (f) => Promise.resolve().then(f),
  Executor,
  executor: (label) => new Executor(`${label}`),
  on: (_executor, f) => f,
};
