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

  const msg = f => page.locator(`[data-msg-for="${f}"]`);
  const count = f => page.textContent(`[data-count-for="${f}"]`);
  const panelHas = (f, cls) => page.locator(`.panel[data-format="${f}"]`).getAttribute('class').then(c => c.split(' ').includes(cls));

  await t('invalid input: message, aria-invalid, other fields greyed out', async () => {
    await page.reload();
    await page.fill(IDS.hex, '48 6g zz');
    assert.ok(await msg('hex').isVisible());
    assert.ok((await msg('hex').getAttribute('class')).includes('is-error'));
    const m = await msg('hex').textContent();
    assert.ok(m.includes('"g" at position 5') && m.includes('2 more invalid characters'), m);
    assert.strictEqual(await page.getAttribute(IDS.hex, 'aria-invalid'), 'true');
    for (const f of ['text', 'dec', 'bin', 'b64']) assert.ok(await panelHas(f, 'is-stale'), f);
    assert.ok(!(await panelHas('hex', 'is-stale')));
    await page.fill(IDS.hex, '48 65');
    assert.ok(!(await msg('hex').isVisible()));
    assert.strictEqual(await page.getAttribute(IDS.hex, 'aria-invalid'), null);
    for (const f of Object.keys(IDS)) assert.ok(!(await panelHas(f, 'is-stale')), f);
  });

  await t('message names invisible chars by code point and counts emoji as one position', async () => {
    await page.reload();
    await page.fill(IDS.dec, '72​');
    assert.ok((await msg('dec').textContent()).startsWith('U+200B at position 3'));
    await page.fill(IDS.hex, '4\u{1F600}');
    assert.ok((await msg('hex').textContent()).startsWith('"\u{1F600}" at position 2'));
  });

  await t('red border removed when the field is overwritten with a valid result', async () => {
    await page.reload();
    await page.fill(IDS.hex, 'zz');
    await page.fill(IDS.text, 'Az');
    assert.ok(!(await panelHas('hex', 'is-invalid')));
    assert.strictEqual(await page.getAttribute(IDS.hex, 'aria-invalid'), null);
    assert.ok(!(await msg('hex').isVisible()));
  });

  await t('hints for partly ignored input, only on the field being typed in', async () => {
    const cases = [
      ['hex', '486', 'The last digit is ignored'],
      ['bin', '0100100', 'The last 7 bits are ignored'],
      ['dec', '0721011', 'The last digit is ignored'],
      ['dec', '70000', '70000 is above 65535'],
      ['b64', 'A', 'This Base64 is incomplete'],
    ];
    for (const [f, v, want] of cases) {
      await page.reload();
      await page.fill(IDS[f], v);
      const m = await msg(f).textContent();
      assert.ok(m.startsWith(want), `${f} ${v}: ${m}`);
      assert.ok(!(await msg(f).getAttribute('class')).includes('is-error'));
      await page.fill(IDS.text, 'x');
      assert.ok(!(await msg(f).isVisible()), f + ' hidden after typing elsewhere');
    }
    await page.reload();
    await page.fill(IDS.hex, '4865');
    assert.ok(!(await msg('hex').isVisible()));
  });

  await t('size counters', async () => {
    await page.reload();
    for (const f of ['dec', 'bin', 'hex']) await setMode(page, f, 'space');
    for (const f of Object.keys(IDS)) assert.strictEqual(await count(f), '', f);
    await page.fill(IDS.text, 'A');
    assert.strictEqual(await count('text'), '1 char · 1 byte UTF-8');
    await page.fill(IDS.text, 'Hi');
    assert.strictEqual(await count('dec'), '2 codes · 7 chars');
    assert.strictEqual(await count('bin'), '2 bytes · 17 chars');
    assert.strictEqual(await count('hex'), '2 bytes · 5 chars');
    assert.strictEqual(await count('b64'), '4 chars · 2 bytes');
    await page.fill(IDS.text, 'héllo\u{1F600}');
    assert.strictEqual(await count('text'), '6 chars · 10 bytes UTF-8');
    await page.fill(IDS.hex, 'zz');
    assert.strictEqual(await count('hex'), '2 chars');
  });

  await t('Clear all, Undo clear, undo dropped on typing or after 5 s', async () => {
    await page.reload();
    const btn = page.locator('#clear-all');
    assert.ok(await btn.isDisabled());
    await page.fill(IDS.text, 'Hi');
    await page.fill(IDS.hex, '48 zz');
    await btn.click();
    for (const f of Object.keys(IDS)) {
      assert.strictEqual(await val(page, f), '', f);
      assert.ok(!(await panelHas(f, 'is-invalid')) && !(await panelHas(f, 'is-source')), f);
      assert.ok(await page.locator(`[data-copy="${f}"]`).isDisabled(), f);
    }
    assert.strictEqual((await btn.textContent()).trim(), 'Undo clear');
    await btn.click();
    assert.strictEqual(await val(page, 'hex'), '48 zz');
    assert.strictEqual(await val(page, 'text'), 'Hi');
    assert.ok(await panelHas('hex', 'is-invalid') && await panelHas('hex', 'is-source'));
    assert.ok(await msg('hex').isVisible());
    assert.strictEqual((await btn.textContent()).trim(), 'Clear all');
    await btn.click();
    await page.fill(IDS.text, 'new');
    assert.strictEqual((await btn.textContent()).trim(), 'Clear all');
    assert.strictEqual(await val(page, 'hex'), '6e 65 77');
    await btn.click();
    await page.waitForTimeout(5300);
    assert.strictEqual((await btn.textContent()).trim(), 'Clear all');
    assert.ok(await btn.isDisabled());
  });

  await t('fields have accessible names', async () => {
    for (const name of ['TEXT', 'ASCII Decimal', 'Binary', 'Hexadecimal', 'Base64']) {
      assert.strictEqual(await page.getByRole('textbox', { name, exact: true }).count(), 1, name);
    }
  });

  await t('light by default (even with a dark system), dark toggle saved', async () => {
    const LIGHT = { body: 'rgb(245, 245, 245)', panel: 'rgb(255, 255, 255)', text: 'rgb(51, 51, 51)' };
    const DARK = { body: 'rgb(22, 23, 27)', panel: 'rgb(31, 32, 38)', text: 'rgb(228, 228, 232)' };
    const colors = p => p.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      panel: getComputedStyle(document.querySelector('.panel[data-format="hex"]')).backgroundColor,
      text: getComputedStyle(document.body).color,
    }));
    const c = await browser.newContext({ colorScheme: 'dark' });
    const p = await c.newPage();
    await p.goto(url);
    await p.evaluate(() => localStorage.clear());
    await p.reload();
    const toggle = p.locator('#theme-toggle');
    assert.deepStrictEqual(await colors(p), LIGHT);
    assert.strictEqual(await toggle.getAttribute('aria-pressed'), 'false');
    await toggle.click();
    await p.waitForTimeout(300); // let color transitions finish
    assert.deepStrictEqual(await colors(p), DARK);
    assert.strictEqual(await toggle.getAttribute('aria-pressed'), 'true');
    await p.reload();
    assert.deepStrictEqual(await colors(p), DARK, 'dark kept after reload');
    await toggle.click();
    await p.waitForTimeout(300);
    assert.deepStrictEqual(await colors(p), LIGHT);
    await p.reload();
    assert.deepStrictEqual(await colors(p), LIGHT, 'light kept after reload');
    await c.close();
  });

  assert.deepStrictEqual(errors, [], 'page errors');
  await browser.close();

  await t('setting survives closing and reopening the browser', async () => {
    const os = require('os');
    const fs = require('fs');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'paulschou-profile-'));
    try {
      let c = await chromium.launchPersistentContext(profile);
      let p = await c.newPage();
      await p.goto(url);
      await p.evaluate(() => localStorage.clear());
      await p.reload();
      await setMode(p, 'hex', 'none');
      await c.close(); // browser fully closed
      c = await chromium.launchPersistentContext(profile);
      p = await c.newPage();
      await p.goto(url);
      assert.strictEqual(await getMode(p, 'hex'), 'none');
      await p.fill(IDS.text, 'Hi');
      assert.strictEqual(await val(p, 'hex'), '4869');
      await c.close();
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
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
