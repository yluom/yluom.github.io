// Golden-master regression test: run the same scenarios on the baseline page and
// on candidate pages (default settings), diff every field value + panel state.
// usage: node regression.js baseline.html candidate1.html [candidate2.html ...]
// baseline = page before issue #3: git show 148f022:paulschou/index.html > /tmp/baseline.html
const { chromium } = require('playwright');
const path = require('path');

const long = 'The quick brown fox jumps over the lazy dog. '.repeat(25);
const CASES = [
  // [field, value]
  ['text', 'Hello World'], ['text', ''], ['text', 'é à ç ÿ'], ['text', '€ test'],
  ['text', '😀'], ['text', 'line1\nline2\ttab'], ['text', '   spaces   '], ['text', long],
  ['text', '0'], ['text', '\u0000x'], ['text', 'ASCII Ä Ω 中'],
  ['dec', '072 101 108 108 111'], ['dec', '72 101 108 108 111'], ['dec', '8364'],
  ['dec', '0'], ['dec', '000'], ['dec', '072  101\n108'], ['dec', 'abc'], ['dec', '1 2 3'],
  ['dec', '65535'], ['dec', '65536'], ['dec', '72,101'], ['dec', '  '], ['dec', '0721'],
  ['dec', '07210'],
  ['bin', '01001000 01100101'], ['bin', '0100100001100101'], ['bin', '0100100'],
  ['bin', '012'], ['bin', '1'], ['bin', '01001000\n01100101'], ['bin', '11111111 00000000'],
  ['hex', '48 65 6c 6c 6f'], ['hex', '48656c6c6f'], ['hex', '4'], ['hex', 'zz'],
  ['hex', '0x48'], ['hex', '48:65'], ['hex', 'DEADBEEF'], ['hex', '20ac'], ['hex', 'e9'],
  ['b64', 'SGVsbG8='], ['b64', 'SGVsbG8'], ['b64', '!!!'], ['b64', 'w6k='], ['b64', '4oKs'],
  ['b64', ' SGVs bG8= '], ['b64', '/+/+'],
];
// Cases where a behaviour change is intended (tokens of 6+ digits in decimal).
const INTENDED = [
  ['dec', '065083067073073'], ['dec', '100000'], ['dec', '999999999'], ['dec', '0000065'],
];
const SEQUENCES = [
  // typed char by char, snapshot after each key
  ['hex', '48656c'], ['dec', '072101108'], ['bin', '0100100001'], ['text', 'Hé!'],
];

const IDS = { text: '#text-input', dec: '#decimal-input', bin: '#binary-input', hex: '#hex-input', b64: '#base64-input' };

async function snapshot(page) {
  return page.evaluate(() => {
    const ids = { text: 'text-input', dec: 'decimal-input', bin: 'binary-input', hex: 'hex-input', b64: 'base64-input' };
    const out = {};
    for (const [k, id] of Object.entries(ids)) {
      const el = document.getElementById(id);
      const panel = el.closest('.panel');
      out[k] = { v: el.value, src: panel.classList.contains('is-source'), inv: panel.classList.contains('is-invalid') };
    }
    return out;
  });
}

async function run(file, cases) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(file));
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  const results = {};
  const reset = async () => {
    await page.reload();
  };
  for (const [f, v] of cases) {
    await reset();
    await page.fill(IDS[f], v);
    results[`fill ${f} ${JSON.stringify(v)}`] = await snapshot(page);
    // then switch source: type in text afterwards
    await page.fill(IDS.text, 'Az');
    results[`fill ${f} ${JSON.stringify(v)} -> text Az`] = await snapshot(page);
  }
  if (cases === CASES) {
    for (const [f, v] of SEQUENCES) {
      await reset();
      await page.click(IDS[f]);
      for (let i = 0; i < v.length; i++) {
        await page.keyboard.type(v[i]);
        results[`type ${f} ${v.slice(0, i + 1)}`] = await snapshot(page);
      }
      for (let i = 0; i < v.length; i++) await page.keyboard.press('Backspace');
      results[`type ${f} cleared`] = await snapshot(page);
      await page.click('h1'); // blur
      results[`type ${f} cleared+blur`] = await snapshot(page);
    }
  }
  await browser.close();
  return results;
}

(async () => {
  const [base, ...cands] = process.argv.slice(2);
  const all = CASES;
  const ref = await run(base, all);
  const refI = await run(base, INTENDED);
  let failed = false;
  for (const c of cands) {
    const got = await run(c, all);
    const all6 = k => ref[k].dec.src && /\d{6,}/.test(ref[k].dec.v);
    const diffs = Object.keys(ref).filter(k => JSON.stringify(ref[k]) !== JSON.stringify(got[k]));
    const unexpected = diffs.filter(k => !all6(k));
    console.log(`\n== ${path.basename(c)}: ${Object.keys(ref).length} snapshots, ${diffs.length} diffs, ${unexpected.length} unexpected`);
    unexpected.forEach(k => { failed = true; console.log('  DIFF', k, '\n    base', JSON.stringify(ref[k]), '\n    new ', JSON.stringify(got[k])); });
    diffs.filter(all6).forEach(k => console.log(`  expected: ${k}: text ${JSON.stringify(ref[k].text.v)} -> ${JSON.stringify(got[k].text.v)}`));
    const gotI = await run(c, INTENDED);
    console.log('  intended changes (decimal tokens >= 6 digits):');
    Object.keys(refI).filter(k => !k.includes('->')).forEach(k =>
      console.log(`    ${k}: text ${JSON.stringify(refI[k].text.v)} -> ${JSON.stringify(gotI[k].text.v)}`));
  }
  process.exit(failed ? 1 : 0);
})();
