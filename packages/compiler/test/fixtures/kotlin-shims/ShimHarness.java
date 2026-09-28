import dev.orbit.search.Hit;
import dev.orbit.search.Searcher;
import java.lang.reflect.Method;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;

/**
 * Calls generated Kotlin shims as Lucent's JNI glue does: a suspend
 * function's shim with a completion (a BiConsumer of the value or the
 * error), then close() on what it returns to cancel; a default's shim
 * without the arguments it leaves out. Prints one line per case.
 */
public final class ShimHarness {
  public static void main(String[] args) throws Exception {
    Class<?> shims = Class.forName(args[0]);
    Searcher searcher = new Searcher();

    Outcome found = launch(shim(shims, "Searcher_search_", 3), searcher, "or");
    StringBuilder titles = new StringBuilder();
    for (Object hit : (List<?>) found.value(1000)) titles.append(((Hit) hit).getTitle()).append(' ');
    System.out.println("result " + titles.toString().trim());

    Outcome thrown = launch(shim(shims, "Searcher_search_", 5), searcher, "!", 2, 0L);
    Throwable error = thrown.error(1000);
    System.out.println("thrown " + error.getClass().getName() + ": " + error.getMessage());

    long start = System.nanoTime();
    Outcome early = launch(shim(shims, "Searcher_search_", 5), searcher, "o", 5, 5000L);
    early.cancel.close();
    Throwable cancelled = early.error(1000);
    long waited = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
    System.out.println("early " + (cancelled instanceof java.util.concurrent.CancellationException) + " " + (waited < 1000));

    Outcome late = launch(shim(shims, "Searcher_stubborn_", 3), searcher, 200L);
    late.cancel.close();
    System.out.println("late " + late.value(2000));

    Outcome count = launch(shim(shims, "Searcher_count_", 2), searcher);
    Object n = count.value(1000);
    System.out.println("count " + n.getClass().getName() + " " + n);

    Object omitted = shim(shims, "Searcher_describe_", 1).invoke(null, searcher);
    Object prefixOnly = shim(shims, "Searcher_describe_", 2).invoke(null, searcher, "find");
    System.out.println("defaults " + omitted + " " + prefixOnly + " " + searcher.describe("find", null));
  }

  /** What a shim's completion received, and what cancels the call. */
  static final class Outcome {
    final CountDownLatch done = new CountDownLatch(1);
    volatile Object value;
    volatile Throwable error;
    AutoCloseable cancel;

    Object value(long ms) throws Exception {
      if (!done.await(ms, TimeUnit.MILLISECONDS)) throw new AssertionError("no outcome in " + ms + " ms");
      if (error != null) throw new AssertionError("failed", error);
      return value;
    }

    Throwable error(long ms) throws Exception {
      if (!done.await(ms, TimeUnit.MILLISECONDS)) throw new AssertionError("no outcome in " + ms + " ms");
      if (error == null) throw new AssertionError("completed without an error");
      return error;
    }
  }

  static Outcome launch(Method shim, Object... args) throws Exception {
    Outcome outcome = new Outcome();
    BiConsumer<Object, Throwable> done = (value, error) -> {
      outcome.value = value;
      outcome.error = error;
      outcome.done.countDown();
    };

    Object[] all = new Object[args.length + 1];
    System.arraycopy(args, 0, all, 0, args.length);
    all[args.length] = done;
    outcome.cancel = (AutoCloseable) shim.invoke(null, all);
    return outcome;
  }

  /** The shim whose name starts with `prefix`, taking `arity` parameters. */
  static Method shim(Class<?> shims, String prefix, int arity) {
    for (Method m : shims.getMethods())
      if (m.getName().startsWith(prefix) && m.getParameterCount() == arity) return m;
    throw new AssertionError("no shim " + prefix + " of " + arity + " parameters in " + shims.getName());
  }
}
