// Names the C library's headers define as macros (HUGE, DOMAIN and
// howmany in <math.h> and <sys/param.h>, sa_handler in <signal.h>) are
// ordinary TypeScript names: the generated code must not expand them.

const HUGE = 1e300;
let DOMAIN = 2;

/** A struct field and an object literal field. */
interface Action {
  sa_handler: string;
  howmany: number;
}

export function action(n: number): Action {
  return { sa_handler: "ignore", howmany: n };
}

export function describe(a: Action): string {
  return `${a.sa_handler} x${a.howmany}`;
}

/** A function, a parameter and a local. */
export function howmany(NAN: number): number {
  const INFINITY = NAN * 2;

  return INFINITY + DOMAIN;
}

export function huge(domain: number): number {
  DOMAIN = domain;

  return HUGE;
}

/** A class, its field and its method. */
export class Signal {
  sa_handler = "default";

  HUGE(): string {
    return this.sa_handler.toUpperCase();
  }
}

export function signal(): string {
  return new Signal().HUGE();
}
