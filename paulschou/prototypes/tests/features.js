// Feature tests for issue #3 (separators + copy). usage: node features.js page.html [...]
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const IDS = { text: '#text-input', dec: '#decimal-input', bin: '#binary-input', hex: '#hex-input', b64: '#base64-input' };
const val = (page, f) => page.inputValue(IDS[f]);

// Drive the UI control for a format; returns the formats the control affects.
async function setMode(page, f, mode) {
  const ctl = page.locator(`[data-sep-for~="${f}"]`).first();
  const type = await ctl.getAttribute('type');
  const group = (await ctl.getAttribute('data-sep-for')).split(' ');
  if (type === 'checkbox') {
    const want = mode === 'space';
    if ((await ctl.isChecked()) !== want) await page.locator('label', { has: ctl }).click();
  } else {
    const radio = page.locator(`[data-sep-for~="${f}"][value="${mode}"]`);
    await page.locator('label', { has: radio }).click();
  }
  return group;
}
async function getMode(page, f) {
  const ctl = page.locator(`[data-sep-for~="${f}"]`).first();
  if ((await ctl.getAttribute('type')) === 'checkbox') return (await ctl.isChecked()) ? 'space' : 'none';
  return (await page.locator(`[data-sep-for~="${f}"][value="none"]`).isChecked()) ? 'none' : 'space';
}

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') + '\n\tend';

async function test(file) {
  const url = 'file://' + path.resolve(file);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const ok = [];
  const t = async (name, fn) => { await fn(); ok.push(name); };

  await t('defaults are "space" and copy buttons disabled when empty', async () => {
    for (const f of ['dec', 'bin', 'hex']) assert.strictEqual(await getMode(page, f), 'space');
    for (const f of Object.keys(IDS)) assert.ok(await page.locator(`[data-copy="${f}"]`).isDisabled(), f);
  });

  await t('no separator output, others untouched until toggled', async () => {
    await page.fill(IDS.text, 'Hello');
    const group = await setMode(page, 'hex', 'none');
    assert.strictEqual(await val(page, 'hex'), '48656c6c6f');
    if (!group.includes('dec')) assert.strictEqual(await val(page, 'dec'), '072 101 108 108 111');
    await setMode(page, 'dec', 'none');
    await setMode(page, 'bin', 'none');
    assert.strictEqual(await val(page, 'dec'), '072101108108111');
    assert.strictEqual(await val(page, 'bin'), '0100100001100101011011000110110001101111');
    assert.strictEqual(await val(page, 'text'), 'Hello');
    assert.strictEqual(await val(page, 'b64'), 'SGVsbG8=');
  });

  await t('setting persists across reload', async () => {
    await page.reload();
    for (const f of ['dec', 'bin', 'hex']) assert.strictEqual(await getMode(page, f), 'none');
    await page.fill(IDS.text, 'Hi');
    assert.strictEqual(await val(page, 'hex'), '4869');
  });

  await t('round trip without separator (all printable ASCII + \\n \\t)', async () => {
    await page.fill(IDS.text, ASCII);
    const out = {};
    for (const f of ['dec', 'bin', 'hex']) out[f] = await val(page, f);
    for (const f of ['dec', 'bin', 'hex']) {
      await page.reload();
      await page.fill(IDS[f], out[f]);
      assert.strictEqual(await val(page, 'text'), ASCII, f);
      assert.strictEqual(await page.locator(`.panel[data-format="${f}"]`).getAttribute('class').then(c => c.includes('is-invalid')), false);
    }
  });

  await t('toggling never rewrites the field being typed in', async () => {
    await page.reload();
    await setMode(page, 'hex', 'space');
    await page.fill(IDS.hex, '48656c');
    await setMode(page, 'hex', 'none');
    await setMode(page, 'hex', 'space');
    assert.strictEqual(await val(page, 'hex'), '48656c');
    assert.strictEqual(await val(page, 'text'), 'Hel');
  });

  await t('toggling re-renders outputs when another field is source', async () => {
    await page.reload();
    await page.fill(IDS.b64, 'SGk=');
    await setMode(page, 'bin', 'space');
    assert.strictEqual(await val(page, 'bin'), '01001000 01101001');
    await setMode(page, 'bin', 'none');
    assert.strictEqual(await val(page, 'bin'), '0100100001101001');
    assert.strictEqual(await val(page, 'b64'), 'SGk=');
  });

  await t('ambiguity warning only without separator and code above limit', async () => {
    await page.reload();
    for (const f of ['dec', 'bin', 'hex']) await setMode(page, f, 'space');
    await page.fill(IDS.text, 'a€');
    assert.strictEqual(await page.locator('[data-warn-for]:visible').count(), 0);
    await setMode(page, 'hex', 'none');
    assert.ok(await page.locator('[data-warn-for="hex"]').isVisible());
    await page.fill(IDS.text, 'aé'); // 233: ok for hex/bin, ok for dec
    assert.ok(!(await page.locator('[data-warn-for="hex"]').isVisible()));
  });

  await t('copy buttons copy exact field value', async () => {
    await page.reload();
    await setMode(page, 'hex', 'none');
    await page.fill(IDS.text, 'Copy me ✓\nline 2');
    for (const f of Object.keys(IDS)) {
      const btn = page.locator(`[data-copy="${f}"]`);
      assert.ok(await btn.isEnabled(), f);
      await btn.click();
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      assert.strictEqual(clip, await val(page, f), f);
      assert.ok((await btn.getAttribute('class')).includes('is-copied'), f + ' feedback');
    }
    assert.ok((await page.textContent('#copy-status')).includes('copied'));
  });

  await t('copy fallback when Clipboard API is missing', async () => {
    const p2 = await ctx.newPage();
    await p2.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined }); });
    await p2.goto(url);
    await p2.fill(IDS.text, 'fallback!');
    await p2.click('[data-copy="hex"]');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.strictEqual(clip, await val(p2, 'hex'));
    await p2.close();
  });

  await t('works when localStorage throws', async () => {
    const p3 = await ctx.newPage();
    const errs = [];
    p3.on('pageerror', e => errs.push(e.message));
    await p3.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }); });
    await p3.goto(url);
    await p3.fill(IDS.text, 'Hi');
    assert.strictEqual(await val(p3, 'hex'), '48 69');
    await setMode(p3, 'hex', 'none');
    assert.strictEqual(await val(p3, 'hex'), '4869');
    assert.deepStrictEqual(errs, []);
    await p3.close();
  });

  assert.deepStrictEqual(errors, [], 'page errors');
  await browser.close();
  return ok;
}

(async () => {
  let fail = false;
  for (const f of process.argv.slice(2)) {
    try {
      const ok = await test(f);
      console.log(`PASS ${path.basename(f)} (${ok.length} tests)`);
    } catch (e) {
      fail = true;
      console.log(`FAIL ${path.basename(f)}: ${e.message}`);
    }
  }
  process.exit(fail ? 1 : 0);
})();
