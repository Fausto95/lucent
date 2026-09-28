var __failures = 0;
var __passes = 0;
function eq(label, actual, expected) {
  var a = JSON.stringify(actual),
    e = JSON.stringify(expected);
  if (a === e) {
    __passes++;
  } else {
    __failures++;
    print("FAIL " + label + ": got " + a + ", expected " + e);
  }
}
function throws(label, fn, check) {
  try {
    fn();
    __failures++;
    print("FAIL " + label + ": did not throw");
  } catch (e) {
    if (check(e)) __passes++;
    else {
      __failures++;
      print("FAIL " + label + ": wrong error " + e + " code=" + e.code);
    }
  }
}
function lucentClass(factory) {
  function C() {
    return factory.apply(undefined, arguments);
  }
  C.prototype = factory.prototype;
  Object.defineProperty(C.prototype, "constructor", { value: C });
  return C;
}

var m = __lucent.manual;
eq("hash", m.hash("hello"), m.hash("hello", 0));
eq("hash seed differs", m.hash("hello") !== m.hash("hello", 7), true);
eq("hash emoji", typeof m.hash("🌍 lucent"), "number");
throws(
  "hash bad arg",
  function () {
    m.hash(42);
  },
  function (e) {
    return (
      e instanceof TypeError &&
      e.message === "hash: argument 'input' must be a string, got a number"
    );
  },
);
eq("midpoint", m.midpoint({ x: 0, y: 0 }, { x: 4, y: 2 }), { x: 2, y: 1 });
throws(
  "midpoint bad field",
  function () {
    m.midpoint({ x: 0 }, { x: 1, y: 1 });
  },
  function (e) {
    return e.message === "midpoint: argument 'a'.y must be a number, got undefined";
  },
);
throws(
  "hashMany bad element",
  function () {
    m.hashMany(["a", "b", 3]);
  },
  function (e) {
    return e.message === "hashMany: argument 'inputs'[2] must be a string, got a number";
  },
);
throws(
  "divide by zero",
  function () {
    m.divide(1, 0);
  },
  function (e) {
    return (
      e instanceof Error && e.code === "DIVIDE_BY_ZERO" && e.message === "Cannot divide by zero"
    );
  },
);
var seen = [];
m.each([1, 2, 3], function (v) {
  seen.push(v * 10);
});
eq("sync callback", seen, [10, 20, 30]);
eq(
  "sync callback with result",
  m.sumMapped([1, 2, 3], function (v) {
    return v * v;
  }),
  14,
);
throws(
  "callback throws",
  function () {
    m.sumMapped([1], function () {
      throw new RangeError("inner");
    });
  },
  function (e) {
    return e.name === "RangeError" && e.message === "inner";
  },
);
eq("union number", m.parse("42"), 42);
eq("union string", m.parse("abc"), "abc");

// A NativeBuffer is an opaque handle: JavaScript is lent copies of its bytes.
var buffer = m.bufferOf(new Uint8Array([1, 2, 3]));
eq("buffer size", buffer.byteLength, 3);
eq("buffer identity", m.bufferEcho(buffer) === buffer, true);
eq("buffer is no ArrayBuffer", buffer instanceof ArrayBuffer || ArrayBuffer.isView(buffer), false);
var snapshot = buffer.toUint8Array();
snapshot[0] = 100;
eq("buffer snapshot", Array.from(snapshot), [100, 2, 3]);
eq("buffer after snapshot", m.bufferSum(buffer), 6);
eq(
  "buffer read",
  buffer.withRead(function (bytes) {
    return bytes[2] * 10 + bytes.length;
  }),
  33,
);
throws(
  "buffer write inside a read",
  function () {
    buffer.withRead(function () {
      buffer.withWrite(function () {});
    });
  },
  function (e) {
    return e.name === "InvalidStateError" && e.message === "NativeBuffer is borrowed";
  },
);
buffer.withWrite(function (bytes) {
  bytes[0] = 10;
  bytes.fill(5, 1);
});
eq("buffer written", m.bufferSum(buffer), 20);
var moved = buffer.transfer();
eq("buffer moved", [buffer.byteLength, moved.byteLength, m.bufferSum(moved)], [0, 3, 20]);
throws(
  "buffer used after its transfer",
  function () {
    m.bufferSum(buffer);
  },
  function (e) {
    return e.name === "InvalidStateError" && e.message === "NativeBuffer was transferred";
  },
);
moved.close();
moved.close();
eq("buffer closed", moved.byteLength, 0);
throws(
  "buffer read after close",
  function () {
    moved.toUint8Array();
  },
  function (e) {
    return e.name === "InvalidStateError" && e.message === "NativeBuffer is closed";
  },
);
throws(
  "not a buffer",
  function () {
    m.bufferSum(new Uint8Array(2));
  },
  function (e) {
    return (
      e instanceof TypeError &&
      e.message === "bufferSum: argument 'buffer' must be a NativeBuffer, got an object"
    );
  },
);

var Counter = lucentClass(m.Counter);
var c = new Counter(5);
eq("class method", c.increment(2), 7);
eq("class getter", c.count, 7);
eq("instanceof", c instanceof Counter, true);

var steps = [];
m.hashMany(["a", "b"]).then(function (r) {
  eq("async result", r, [m.hash("a"), m.hash("b")]);
});
m.progress(3, function (i) {
  steps.push(i);
}).then(function (n) {
  eq("async callback steps", steps, [1, 2, 3]);
  eq("async return", n, 3);
});
m.askJs(function (q) {
  return Promise.resolve("JS answered " + q);
}).then(function (r) {
  eq("await JS promise", r, "got JS answered name?");
});
m.askJs(function () {
  return Promise.reject(new Error("no"));
}).then(
  function () {
    __failures++;
    print("FAIL: should reject");
  },
  function (e) {
    eq("rejection passes through", e.message, "no");
  },
);
// bigint: exact both ways, within 64 bits and beyond them.
function eqBig(label, actual, expected) {
  if (typeof actual === "bigint" && actual === expected) {
    __passes++;
  } else {
    __failures++;
    print(
      "FAIL " +
        label +
        ": got " +
        String(actual) +
        " (" +
        typeof actual +
        "), expected " +
        String(expected),
    );
  }
}
[
  0n,
  1n,
  -1n,
  9007199254740993n,
  2n ** 63n - 1n,
  -(2n ** 63n),
  2n ** 63n,
  2n ** 64n - 1n,
  2n ** 64n,
  -(2n ** 64n) - 1n,
  2n ** 200n + 12345n,
  -(3n ** 150n),
].forEach(function (x) {
  eqBig("bigint round trip " + String(x), m.bigEcho(x), x);
});
eqBig("bigint add across 64 bits", m.bigAdd(2n ** 64n - 1n, 1n), 2n ** 64n);
eqBig("bigint add back within", m.bigAdd(2n ** 64n, -(2n ** 64n) + 5n), 5n);
eqBig("bigint through int64_t", m.bigInt64(-(2n ** 63n)), -(2n ** 63n));
throws(
  "bigint beyond int64_t",
  function () {
    m.bigInt64(2n ** 63n);
  },
  function (e) {
    return e instanceof RangeError;
  },
);
throws(
  "a number is not a bigint",
  function () {
    m.bigEcho(1);
  },
  function (e) {
    return e instanceof TypeError && /argument 'x' must be a bigint/.test(e.message);
  },
);
setTimeout(function () {
  print(__passes + " passed, " + __failures + " failed");
}, 200);
