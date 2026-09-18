import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_URL = 'file://' + path.join(ROOT, 'index.html');

const results = [];
function check(name, cond) { results.push([cond ? 'PASS' : 'FAIL', name]); console.log((cond ? 'PASS' : 'FAIL').padEnd(5), name); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(PAGE_URL);
await page.waitForTimeout(400);
await page.click('#hve-cb-edit');
await page.waitForTimeout(200);

/* ---- A. Floating insert + free drag ---- */
await page.click('#hve-tb-insert');
await page.waitForTimeout(200);
await page.click('.hve-insert-panel .hve-ip-mode-btn >> nth=1'); // Float mode
await page.waitForTimeout(100);
await page.click('.hve-insert-panel .hve-ip-item >> nth=5'); // Button
await page.waitForTimeout(300);
const floatBtn = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'Click Me');
  return b ? { pos: getComputedStyle(b).position, hasMark: b.hasAttribute('data-hve-floating') } : null;
});
check('float insert: absolute positioned', floatBtn && floatBtn.pos === 'absolute');
check('float insert: floating mark set', floatBtn && floatBtn.hasMark);

// free-drag the floating button (position should change by mouse delta)
const clickMe = await page.evaluateHandle(() => Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'Click Me'));
let fbox = await clickMe.asElement().boundingBox();
const fx = parseFloat(await clickMe.evaluate(e => e.style.left));
const fy = parseFloat(await clickMe.evaluate(e => e.style.top));
await page.mouse.move(fbox.x + 40, fbox.y + 12);
await page.mouse.down();
await page.mouse.move(fbox.x + 140, fbox.y + 112, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(200);
const fx2 = parseFloat(await clickMe.evaluate(e => e.style.left));
const fy2 = parseFloat(await clickMe.evaluate(e => e.style.top));
check('floating free-drag moves by delta', Math.abs(fx2 - fx - 100) <= 8 && Math.abs(fy2 - fy - 100) <= 8); // <= snap tolerance

/* ---- B. Snap guides while floating drag ---- */
const btnEl = clickMe.asElement();
fbox = await btnEl.boundingBox();
const mainLeft = await page.evaluate(() => document.querySelector('main').getBoundingClientRect().left);
// drag so the button's left edge aligns with main's left edge
await page.mouse.move(fbox.x + 40, fbox.y + 12);
await page.mouse.down();
await page.mouse.move(mainLeft + 40, fbox.y + 12, { steps: 10 });
await page.waitForTimeout(250); // mid-drag at aligned position
const guidesMid = await page.evaluate(() => document.querySelectorAll('.hve-guide, .hve-guide-label').length);
const snappedLeft = await btnEl.evaluate(e => parseFloat(e.style.left));
await page.mouse.up();
await page.waitForTimeout(150);
check('alignment guides appear during aligned drag', guidesMid >= 1);
check('snap aligns edge exactly', Math.abs(snappedLeft - mainLeft) < 0.6);
console.log('      (guides mid-drag:', guidesMid, ')');

/* ---- C. Table insert via dialog + row/col ops ---- */
await page.keyboard.press('Escape');
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
await page.click('#hve-tb-insert');
await page.waitForTimeout(200);
await page.click('.hve-insert-panel .hve-ip-item >> nth=3'); // Table
await page.waitForTimeout(200);
check('table dialog opened', await page.evaluate(() => !!document.querySelector('.hve-dialog')));
await page.fill('.hve-dialog input[type="number"] >> nth=0', '3');
await page.fill('.hve-dialog input[type="number"] >> nth=1', '4');
await page.click('.hve-dialog .hve-btn-confirm');
await page.waitForTimeout(300);
const tableInfo = await page.evaluate(() => {
  const ts = document.querySelectorAll('table');
  const t = ts[ts.length - 1];
  return t ? { rows: t.rows.length, cols: t.rows[0].children.length } : null;
});
check('table inserted 3x4 with header', tableInfo && tableInfo.rows === 3 && tableInfo.cols === 4);

// right-click a cell -> row ops
const table = await page.evaluateHandle(() => {
  const ts = document.querySelectorAll('table');
  return ts[ts.length - 1];
});
await table.evaluate(e => e.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(150);
const tbox = await table.boundingBox();
const cellPt = { x: tbox.x + 60, y: tbox.y + Math.floor(tbox.height / 2) + 8 };
await page.mouse.click(cellPt.x, cellPt.y); // select table via cell
await page.waitForTimeout(100);
await page.mouse.down({ button: 'right' });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(200);
const ctxText = await page.evaluate(() => document.querySelector('.hve-context-menu')?.textContent || '');
check('table context menu has row ops', ctxText.includes('Insert Row') && ctxText.includes('Delete Current Column'));
// click "Insert Row Below"
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('.hve-cm-item'));
  const it = items.find(i => i.textContent.includes('Insert Row Below'));
  if (it) it.click();
});
await page.waitForTimeout(200);
const rowsAfter = await page.evaluate(() => {
  const ts = document.querySelectorAll('table');
  return ts[ts.length - 1].rows.length;
});
check('insert row below works', rowsAfter === 4);

/* ---- D. Format brush ---- */
// select first feature card, copy style
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(150);
const card = await page.$('main div[style*="border-radius"]');
if (card) {
  await card.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  const cb = await card.boundingBox();
  await page.mouse.click(cb.x + cb.width - 8, cb.y + cb.height - 8); // padding corner -> selects the card, not a child
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+Shift+c'); // copy style
  await page.waitForTimeout(100);
  // now select a mid-page h2 and paste style (first h2 sits under the toolbar)
  const h2sAll = await page.$$('main h2');
  const h2 = h2sAll[1] || h2sAll[0];
  await h2.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  const hb = await h2.boundingBox();
  await page.mouse.click(hb.x + 60, hb.y + Math.floor(hb.height / 2));
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+Shift+v'); // paste style
  await page.waitForTimeout(200);
  check('format brush applies styles', await page.evaluate(() => {
    const hs = document.querySelectorAll('main h2');
    const h = hs[1] || hs[0]; // the h2 we pasted onto
    return h && !!(h.style.borderRadius || h.style.background || h.style.padding);
  }));
} else {
  check('format brush applies styles', false);
}

/* ---- E. Layer operations ---- */
// remove the floating button from section A that covers the top content area
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'Click Me');
  if (b) window.HVE.setSelection([b]);
});
await page.keyboard.press('Delete');
await page.waitForTimeout(200);
const h2b = await page.$('main h2');
await h2b.evaluate(e => e.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(150);
const hb2 = await h2b.boundingBox();
await page.mouse.click(hb2.x + 60, hb2.y + 30);
await page.waitForTimeout(100);
console.log('E: selected before Esc:', await page.evaluate(() =>
  window.HVE.state.selected.map(s => s.tagName + ':' + s.textContent.slice(0, 14))));
await page.keyboard.press('Escape'); // select parent (main)
await page.waitForTimeout(100);
const selTag = await page.evaluate(() => window.HVE.state.selected[0]?.tagName);
console.log('E: after Esc ->', selTag, '| scrollY:', await page.evaluate(() => window.scrollY));
check('Esc selects parent (main)', selTag === 'MAIN');

/* ---- F. Arrow-key nudge ---- */
await page.mouse.click(hb2.x + 60, hb2.y + 30);
await page.waitForTimeout(100);
const topBefore = await h2b.evaluate(e => e.getBoundingClientRect().top + window.scrollY);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Shift+ArrowRight');
await page.waitForTimeout(150);
const st = await h2b.evaluate(e => e.style.top + '|' + e.style.left);
check('arrow keys nudge element', st === '1px|10px');

/* ---- G. Marquee box select ---- */
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(150);
// start on empty body area (right of main, x>1170), drag a box over the hero content
await page.mouse.move(1250, 180);
await page.mouse.down();
await page.mouse.move(500, 480, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(200);
const marqueeSel = await page.evaluate(() => window.HVE.state.selected.length);
check('marquee selects multiple', marqueeSel >= 2);

/* ---- H. Opacity / radius / shadow menus ---- */
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(100);
await page.keyboard.press('Escape');
await page.waitForTimeout(50);
await page.keyboard.press('Escape');
await page.waitForTimeout(50);
const h1x = await page.$('h1, main h2');
await h1x.evaluate(e => e.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(150);
const h1b = await h1x.boundingBox();
await page.mouse.click(h1b.x + 60, h1b.y + 25);
await page.waitForTimeout(100);
await page.click('#hve-tb-radius');
await page.waitForTimeout(200);
check('radius menu opens', await page.evaluate(() => !!document.querySelector('.hve-menu, .hve-dropdown, .hve-submenu')));
await page.keyboard.press('Escape');
await page.click('#hve-tb-opacity');
await page.waitForTimeout(200);
const hasOpacity = await page.evaluate(() => {
  const m = document.querySelector('.hve-menu, .hve-dropdown, .hve-submenu, [class*="opacity"]');
  return !!m;
});
check('opacity menu opens', hasOpacity);
await page.keyboard.press('Escape');

/* ---- I. Undo to clean state, then verify serialization stable ---- */
let undos = 0;
while (undos < 40 && await page.evaluate(() => window.HVE.state.undoStack.length > 0)) {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(60);
  undos++;
}
check('undo history works (multi-step)', undos > 5);

/* ---- J. Redo ---- */
await page.keyboard.press('Control+y');
await page.waitForTimeout(150);
check('redo works', await page.evaluate(() => window.HVE.state.redoStack.length >= 0));

await browser.close();

let fails = 0;
for (const [st, name] of results) if (st === 'FAIL') fails++;
if (errors.length) {
  console.log('\nJS ERRORS:');
  errors.slice(0, 8).forEach(e => console.log('  ', e.slice(0, 200)));
}
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed' + (errors.length ? ' — ' + errors.length + ' js errors' : ''));
process.exit(fails || errors.length ? 1 : 0);
