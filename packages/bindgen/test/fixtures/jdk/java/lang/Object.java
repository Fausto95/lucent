package java.lang;

/** java.lang.Object as android.jar declares it, reduced to what the fixtures need. */
public class Object {
  public Object() {}

  public boolean equals(Object other) {
    return this == other;
  }
}
