import dev.orbit.ticker.Ticker;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import kotlin.jvm.functions.Function1;

/**
 * Calls the shims of a Kotlin flow's collect and of suspend functions
 * taking suspend functions as Lucent's JNI glue does: the Lucent function
 * is a kotlin.jvm.functions.Function1 (the glue's is a NativeProxy), which
 * the shim runs as the suspend function Kotlin takes. Prints one line per
 * case.
 */
public final class FlowHarness {
  public static void main(String[] args) throws Exception {
    Class<?> flows = Class.forName("dev.lucent.shims.LucentShims_kotlinx_coroutines_flow");
    Class<?> tickers = Class.forName("dev.lucent.shims.LucentShims_dev_orbit_ticker");
    Method collect = ShimHarness.shim(flows, "Flow_collect_", 3);
    Ticker ticker = new Ticker();

    List<Object> seen = Collections.synchronizedList(new ArrayList<>());
    Function1<Object, Object> record = value -> {
      seen.add(value);
      return null;
    };

    ShimHarness.Outcome counted = ShimHarness.launch(collect, ticker.count(3, 0L), record);
    counted.value(2000);
    System.out.println("values " + join(seen) + " completed");

    seen.clear();
    ShimHarness.Outcome failing = ShimHarness.launch(collect, ticker.failing("one"), record);
    Throwable failed = failing.error(2000);
    System.out.println("failed " + join(seen) + " " + failed.getClass().getName() + ": " + failed.getMessage());

    seen.clear();
    ShimHarness.Outcome forever = ShimHarness.launch(collect, ticker.forever(5L), record);
    while (seen.size() < 3) Thread.sleep(1);
    forever.cancel.close();
    Throwable cancelled = forever.error(2000);
    long until = System.currentTimeMillis() + 2000;
    while (ticker.getCancelled() == 0 && System.currentTimeMillis() < until) Thread.sleep(1);
    System.out.println(
        "cancelled " + (cancelled instanceof java.util.concurrent.CancellationException) + " " + Math.min(seen.size(), 3) + " " + (ticker.getCancelled() == 1 ? "stopped" : "running"));

    RuntimeException own = new RuntimeException("stop");
    List<Object> before = new ArrayList<>();
    Function1<Object, Object> throwing = value -> {
      before.add(value);
      if (before.size() == 2) throw own;
      return null;
    };
    ShimHarness.Outcome thrown = ShimHarness.launch(collect, ticker.count(5, 0L), throwing);
    Throwable error = thrown.error(2000);
    System.out.println("thrown " + (error == own ? "the collector's own exception" : "another: " + error) + ", after " + before.size());

    List<Object> steps = new ArrayList<>();
    Function1<Object, Object> step = value -> {
      steps.add(value);
      return null;
    };
    Object n = ShimHarness.launch(ShimHarness.shim(tickers, "Ticker_each_", 4), ticker, List.of("a", "b"), step).value(2000);
    System.out.println("each " + n + " " + join(steps));

    Thread caller = Thread.currentThread();
    Thread[] ran = new Thread[1];
    Function1<Object, Object> upper = value -> {
      ran[0] = Thread.currentThread();
      return ((String) value).toUpperCase();
    };
    Object up = ShimHarness.launch(ShimHarness.shim(tickers, "Ticker_transformed_", 4), ticker, "x", upper).value(2000);
    System.out.println("transformed " + up + (ran[0] != caller ? " on another thread" : " on the caller's thread"));
  }

  static String join(List<Object> values) {
    StringBuilder b = new StringBuilder();
    synchronized (values) {
      for (Object v : values) b.append(b.length() == 0 ? "" : ",").append(v);
    }
    return b.toString();
  }
}
