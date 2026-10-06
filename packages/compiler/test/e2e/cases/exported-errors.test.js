const ParseError = lucentClass(mod.ParseError);
const TokenError = lucentClass(mod.TokenError);

// Constructed by JavaScript.
const made = new ParseError("bad", 2);
print(made.message, made.name, made.line, String(made), typeof made.stack);
print(made instanceof ParseError, made instanceof Error, made instanceof TokenError);
print(mod.describe(made), mod.kind(made));
made.message = "changed";
made.name = "Renamed";
print(mod.describe(made), String(made));

const token = new TokenError("}");
print(token.message, token.name, token.line, token.token, String(token));
print(token instanceof TokenError, token instanceof ParseError, token instanceof Error);
print(mod.kind(token));

// Made by Lucent and returned.
const returned = mod.parse(5);
print(returned.message, returned.name, returned.line, String(returned));
print(returned instanceof ParseError, returned instanceof Error);
const plain = mod.asError(6);
print(plain.message, plain.name, plain instanceof ParseError, plain instanceof Error);
print(mod.kind(plain), mod.kind(new Error("plain")));

// Thrown by Lucent and caught by JavaScript.
try {
  mod.fail(7);
} catch (e) {
  print(e.message, e.name, e.line, String(e), typeof e.stack);
  print(e instanceof ParseError, e instanceof Error, mod.kind(e));
}
try {
  mod.failToken("]");
} catch (e) {
  print(e.token, e.line, String(e), e instanceof TokenError, e instanceof ParseError);
}
try {
  mod.raise(made);
} catch (e) {
  print(e === made, e.message);
}
mod.later(8).catch((e) => print("later", e.message, e.line, e instanceof ParseError));
