package com.example.decl;

/** An abstract class Lucent code extends, through its public constructor (BiometricPrompt.AuthenticationCallback's shape). */
public abstract class Callback {
  public Callback() {}

  public abstract void onDone(int code);
}
