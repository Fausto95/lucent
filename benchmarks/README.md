# Benchmarks

Two kinds of measurement live here.

## Host runs, published on the website

`results/<name>.json` holds runs of `scripts/bench.ts`: the kernels in
`packages/compiler/test/e2e/cases/kernels.lucent.ts`, compiled by Lucent and
run as JavaScript in one Hermes runtime, and the boundary's cost against a
bare C++ host function. The website's
[comparison page](https://lucent-lang.dev/docs/guides/comparison/#performance)
shows each file as a dated table. These run on a computer, not a phone: they
compare Lucent with JavaScript on the same machine, not with other tools.

To publish a run, on a quiet machine (no other builds running):

```sh
HERMES_DIR=~/hermes node scripts/bench.ts --json /tmp/bench.json
node scripts/bench-publish.ts /tmp/bench.json        # writes results/<platform>-<arch>.json
node scripts/website.ts                              # regenerates the page's tables
```

Commit the results file with the regenerated website files. Run from a clean
tree, so the recorded commit is the code that was measured.

## Device comparisons, not yet published

`bench-expo`, `bench-nitro`, `bench-turbo` and `bench-turbo-cxx` are
[NitroBenchmarks](https://github.com/mrousavy/NitroBenchmarks)' modules, as
workspace packages the example apps link. Their Compare tab times 100,000
calls of `addNumbers` and `addStrings` through each, beside Lucent. Run it
in a Release build ([docs/testing.md](../docs/testing.md)). Its results
aren't published until they come from physical devices, which
[docs/limitations.md](../docs/limitations.md) defers to the maintainer.
