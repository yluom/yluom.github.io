# Issue #3 prototypes (temporary)

Three UX variants for [issue #3](https://github.com/yluom/yluom.github.io/issues/3):
copy-to-clipboard buttons on every panel, and a space / no-separator option for
Decimal, Binary and Hex output. All three share the same script; only the UI differs.

| File | UX |
|---|---|
| `a-header.html` | Per-panel controls in the panel header: `a b` / `ab` toggle + copy icon |
| `b-toolbar.html` | One global separator toggle under the title + labelled "Copy" buttons |
| `c-field.html` | Copy icon inside the field (top-right) + per-panel switch under the field |

Once a variant is chosen it replaces `paulschou/index.html` and this folder is deleted.

## Behaviour (same in all variants)

- Default separator is a space: output is identical to the current page.
- The preference is saved in `localStorage` (`paulschou.separators`); the page works without it.
- Changing the separator re-renders the other panels, never the panel being typed in.
- Copy uses the Clipboard API, with an `execCommand('copy')` fallback. Buttons are disabled on empty fields.
- A warning appears when "no separator" output contains codes too large to be split back
  (above 999 in Decimal, above 255 in Binary/Hex).
- Decimal decoding: a run of 6+ digits (impossible for a single char code, max 65535)
  is now read as 3-digit groups, so `072101108` decodes to `Hel`. This is the only
  intentional change for existing inputs.

## Tests

Needs Node and Playwright (Chromium).

```sh
git show main:paulschou/index.html > /tmp/baseline.html
# Golden master: same scenarios on the current page and on each prototype, default settings
node tests/regression.js /tmp/baseline.html a-header.html b-toolbar.html c-field.html
# Separators, round trip, persistence, copy, fallbacks
node tests/features.js a-header.html b-toolbar.html c-field.html
```
