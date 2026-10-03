import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintStream;
import java.lang.reflect.Method;
import java.net.StandardProtocolFamily;
import java.net.UnixDomainSocketAddress;
import java.nio.channels.Channels;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.spi.ToolProvider;
import javax.tools.JavaCompiler;

/**
 * The JVM tools the tests run (kotlinc, javac, jar), kept warm: listens on
 * the Unix socket its first argument names and runs each request (the
 * tool, then its command-line arguments, on one line separated by tabs) in
 * this JVM, as the command would. It answers the command's exit code and
 * the length in bytes of its standard output, a line each, then what it
 * printed on its standard output and its standard error. It exits when its
 * parent closes its standard input. kotlinc needs the Kotlin compiler on
 * the classpath; javac and jar are the JDK's own.
 */
public final class ToolServer {
  public static void main(String[] args) throws IOException {
    Path socket = Path.of(args[0]);
    Files.deleteIfExists(socket);

    ServerSocketChannel server = ServerSocketChannel.open(StandardProtocolFamily.UNIX);
    server.bind(UnixDomainSocketAddress.of(socket));

    Thread parent = new Thread(() -> {
      try {
        while (System.in.read() != -1) {}
      } catch (IOException ignored) {
      }
      System.exit(0);
    });
    parent.setDaemon(true);
    parent.start();

    for (;;) {
      try (SocketChannel client = server.accept()) {
        BufferedReader in = new BufferedReader(
            new InputStreamReader(Channels.newInputStream(client), StandardCharsets.UTF_8));
        String[] request = in.readLine().split("\t", -1);
        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        ByteArrayOutputStream stderr = new ByteArrayOutputStream();
        PrintStream out = new PrintStream(stdout, true, StandardCharsets.UTF_8);
        PrintStream err = new PrintStream(stderr, true, StandardCharsets.UTF_8);
        int code;

        try {
          code = run(request[0], Arrays.copyOfRange(request, 1, request.length), out, err);
        } catch (Exception e) {
          e.printStackTrace(err);
          code = 70;
        }

        OutputStream answer = Channels.newOutputStream(client);
        answer.write((code + "\n" + stdout.size() + "\n").getBytes(StandardCharsets.UTF_8));
        answer.write(stdout.toByteArray());
        answer.write(stderr.toByteArray());
        answer.flush();
      }
    }
  }

  /** Runs `tool` with `args`, printing to `out` and `err` as the command does: its exit code. */
  private static int run(String tool, String[] args, PrintStream out, PrintStream err)
      throws Exception {
    switch (tool) {
      case "kotlinc": {
        // A new compiler for each compile, as kotlinc makes one.
        Class<?> compiler = Class.forName("org.jetbrains.kotlin.cli.jvm.K2JVMCompiler");
        Method exec = compiler.getMethod("exec", PrintStream.class, String[].class);
        Object exit = exec.invoke(compiler.getConstructor().newInstance(), err, args);

        return (int) exit.getClass().getMethod("getCode").invoke(exit);
      }
      case "javac": {
        JavaCompiler javac = javax.tools.ToolProvider.getSystemJavaCompiler();

        return javac.run(null, out, err, args);
      }
      default:
        return ToolProvider.findFirst(tool).orElseThrow().run(out, err, args);
    }
  }
}
