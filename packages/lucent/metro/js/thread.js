"use strict";
// lucent:thread in JS dev mode: JavaScript has one thread, so main() runs
// its function on it, later, as the native main() runs it on the main
// thread and settles the promise with its result or its error.
module.exports = {
  main: (f) => Promise.resolve().then(f),
};
