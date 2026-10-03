import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintStream;
import java.net.StandardProtocolFamily;
import java.net.UnixDomainSocketAddress;
import java.nio.channels.Channels;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.jetbrains.kotlin.cli.jvm.K2JVMCompiler;

/**
 * kotlinc, kept warm for the tests: listens on the Unix socket its first
 * argument names and compiles each request (kotlinc's arguments, one line,
 * separated by tabs) with a new K2JVMCompiler, as kotlinc does. It answers
 * kotlinc's exit code on a line, then what kotlinc would print; it exits
 * when its parent closes its standard input.
 */
public final class KotlinServer {
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
        ByteArrayOutputStream printed = new ByteArrayOutputStream();
        int code = new K2JVMCompiler()
            .exec(new PrintStream(printed, true, StandardCharsets.UTF_8), request)
            .getCode();

        OutputStream out = Channels.newOutputStream(client);
        out.write((code + "\n").getBytes(StandardCharsets.UTF_8));
        out.write(printed.toByteArray());
        out.flush();
      }
    }
  }
}
