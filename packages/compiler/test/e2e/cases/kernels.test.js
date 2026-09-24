for (const name of [
  "murmur",
  "fnv1a",
  "crc32",
  "xorshift",
  "sieve",
  "mandelbrot",
  "sortNumbers",
  "wordCount",
  "strings",
]) {
  print(name, mod[name](1), mod[name](300), mod[name](5000));
}
