# Paulschou Converter tests

Needs Node and Playwright (Chromium). Run from this folder.

```sh
# Page before issue #3, used as the reference
git show 148f022:paulschou/index.html > /tmp/baseline.html

# Non-regression: same scenarios on the reference and on the current page
# (default settings), compares all 5 fields and panel states
node regression.js /tmp/baseline.html ../index.html

# Issue #3 features: separators, round trip, persistence (reload and browser
# restart), copy buttons, Clipboard API / localStorage fallbacks
node features.js ../index.html
```

Expected: `0 unexpected` diffs. The listed "expected" diffs are Decimal inputs with
6+ digits in a row, which are now read as 3-digit groups (`072101108` -> `Hel`).
