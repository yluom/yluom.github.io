# Paulschou Converter tests

Needs Node and Playwright (Chromium). Run from this folder.

```sh
# Reference page: the version before your change, e.g.
git show main:paulschou/index.html > /tmp/baseline.html
# (148f022 = before issue #3, b6e7e98 = issue #3)

# Non-regression: same scenarios on the reference and on the current page
# (default settings), compares all 5 fields and panel states
node regression.js /tmp/baseline.html ../index.html

# Features: separators, round trip, persistence (reload and browser restart),
# copy buttons, Clipboard API / localStorage fallbacks, error messages and hints,
# size counters, Clear all / Undo clear, accessible names, dark mode
node features.js ../index.html
```

Expected: `0 unexpected` diffs. The listed "expected" diffs are intended changes:
- Decimal inputs with 6+ digits in a row are read as 3-digit groups (`072101108` -> `Hel`);
- a field that was invalid and then overwritten with a valid result loses its red border.
