# Ada

[Ada](https://github.com/ada-url/ada) v3.4.4, the WHATWG URL parser Node.js
uses: the single-header release (`singleheader.zip`), dual licensed under
Apache 2.0 and MIT (`LICENSE-APACHE`, `LICENSE-MIT`). Lucent's `URL` and
`URLSearchParams` (`lucent/url/url.cpp`) are built on it.

- `ada.h` is the release's, unchanged.
- `ada.cpp.inc` is the release's `ada.cpp`, unchanged and renamed, so that
  no build compiles it on its own: `lucent_ada.cpp` compiles it without
  URLPattern (`ADA_INCLUDE_URL_PATTERN=0`).

A native package carries this directory and `lucent/url/url.cpp` only for a
program that makes a URL (decision 0107).

To update: download the release's `singleheader.zip`, copy `ada.h` and
`ada.cpp` (as `ada.cpp.inc`), check that they match the tag's
`singleheader/amalgamate.py` output, and change the version here.
