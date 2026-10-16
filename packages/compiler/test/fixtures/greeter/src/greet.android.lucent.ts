import { Greeter, Greetings } from "lucent:android/dev.example.greet";
import { Polite } from "lucent:android/dev.example.greet.java";

/** The package's own Kotlin and Java, called from its Lucent code. */
export function greetings(name: string): string {
  const greeter = new Greeter(name);
  greeter.hear("lucent");
  greeter.hear("jni");
  return [
    greeter.greet(),
    String(greeter.length),
    greeter.heard(),
    greeter.polite(),
    Polite.greet(greeter),
    Greetings.greeting(),
    Greetings.greeting(name),
  ].join(" | ");
}
