print(
  mod.parts(
    [
      "https://example.com",
      "HTTPS://EXAMPLE.com:443/a/./b/../c?q=1#h",
      "http://user:pass@host:8080/p",
      "https://例え.jp/パス?キー=値#é",
      "https://xn--r8jz45g.jp",
      "http://[::1]:3000/",
      "http://192.168.0.1.",
      "http://0x7f.1/",
      "file:///C:/x/../y",
      "mailto:a@b.c",
      "data:text/plain,hi there",
      "blob:https://a.b/uuid",
      "not a url",
      "http://exa mple.com",
      "https://a.b/%zz",
      "  https://trim.me/\t\n  ",
      "https://ex.com/\u{1F600}?\u00e9#\u00e9",
      "javascript:alert(1)",
      "http://256.256.256.256",
      "ws://x/y",
      "https://a.b/\uD800",
    ],
    undefined,
  ),
);
print(
  mod.parts(
    ["../up", "?only", "#frag", "//other.org/p", "/root", "", "sub/../x", "https:no-slashes"],
    "https://example.com/dir/page?q#f",
  ),
);
print(mod.written("https://example.com/path?x=1#y"));
print(mod.linked());
print(mod.params());
print(mod.statics());
