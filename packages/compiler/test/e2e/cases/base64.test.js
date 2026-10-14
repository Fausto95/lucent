print(
  mod.decoded([
    "",
    "YQ",
    "YQ==",
    "YR==",
    "Y Q = =",
    "\tYW\nJj\f\r",
    "abc=",
    "//4=",
    "YQ=",
    "ab=",
    "a",
    "abcde",
    "ab==c",
    "Y=Q=",
    "YQ===",
    "====",
    "€",
    "YQ-_",
  ]),
);
print(mod.encoded(["", "a", "ab", "abc", "abcd", "\xff\xfe\x00", "€"]));
print(mod.roundTrip("héllo, wörld \u{1F600}"));
