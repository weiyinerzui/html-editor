import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_URL = 'file://' + path.join(ROOT, 'index.html');
import fs from 'fs';

const results = [];
function check(name, cond) { results.push([cond ? 'PASS' : 'FAIL', name]); console.log((cond ? 'PASS' : 'FAIL').padEnd(5), name); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// force the English UI so the assertions below stay stable
await page.addInitScript(() => { try { localStorage.setItem('hve-lang', 'en'); } catch (e) {} });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(PAGE_URL);
await page.waitForTimeout(400);

// 1. UI exists
check('control bar rendered', await page.$('.hve-controlbar') !== null);
check('toolbar rendered', await page.$('.hve-toolbar') !== null);
check('starts in view mode', await page.evaluate(() => !window.HVE.state.editMode));

// 2. Enter edit mode
await page.click('#hve-cb-edit');
await page.waitForTimeout(200);
check('edit mode on', await page.evaluate(() => window.HVE.state.editMode));
check('toolbar visible', await page.evaluate(() => getComputedStyle(document.querySelector('.hve-toolbar')).display === 'flex'));
await page.screenshot({ path: '/tmp/shots/01-edit-mode.png' });

// 3. Hover + select
const h1 = await page.$('h1');
const h1box = await h1.boundingBox();
await page.mouse.move(h1box.x + 30, h1box.y + 10);
await page.waitForTimeout(150);
check('hover mark applied', await page.evaluate(() => !!document.querySelector('[data-hve-hovered]')));
await page.mouse.click(h1box.x + 30, h1box.y + 10);
await page.waitForTimeout(200);
check('element selected', await page.evaluate(() => window.HVE.state.selected.length === 1));
check('resize handles visible', await page.evaluate(() => document.querySelector('.hve-resize-box').style.display === 'block'));
await page.screenshot({ path: '/tmp/shots/02-selected.png' });

// 4. Heading retag
check('toolbar buttons enabled', await page.evaluate(() => !document.querySelector('#hve-tb-bold').disabled));
await page.selectOption('#hve-tb-heading', 'H2');
await page.waitForTimeout(150);
check('h1 -> h2 retag', await page.evaluate(() => document.querySelector('main h1') === null && document.querySelector('main h2') !== null));

// 5. Bold toggle (h2 default weight is 700 -> clicking B sets 400) + undo
await page.click('#hve-tb-bold');
await page.waitForTimeout(100);
check('bold toggle applied', await page.evaluate(() => document.querySelector('main h2').style.fontWeight === '400'));
await page.click('#hve-tb-undo');
await page.waitForTimeout(200);
check('undo reverts bold', await page.evaluate(() => document.querySelector('main h2').style.fontWeight !== '400'));

// 6. Inline text edit
const p = await page.$('main p');
const pb = await p.boundingBox();
await page.mouse.dblclick(pb.x + 40, pb.y + 12);
await page.waitForTimeout(200);
check('inline editing entered', await page.evaluate(() => !!window.HVE.state.editingEl && window.HVE.state.editingEl.getAttribute('contenteditable') === 'true'));
await page.keyboard.type(' REPLACED');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('text edited + exited', await page.evaluate(() => !window.HVE.state.editingEl && document.querySelector('main p').textContent.includes('REPLACED')));

// 7. Drag reorder + undo
const h2s = await page.$$('main h2');
const a = await h2s[2].boundingBox();
const b = await h2s[1].boundingBox();
await page.mouse.move(a.x + 30, a.y + 12);
await page.mouse.down();
await page.mouse.move(a.x + 30, b.y - 5, { steps: 12 });
await page.mouse.move(a.x + 30, b.y - 5, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(250);
const order = await page.evaluate(() => Array.from(document.querySelectorAll('main h2')).map(h => h.textContent.trim()));
check('drag reorder works', order[1] === 'Everything you need' && order[2] === 'Get started in 5 steps');
await page.click('#hve-tb-undo');
await page.waitForTimeout(250);
const order2 = await page.evaluate(() => Array.from(document.querySelectorAll('main h2')).map(h => h.textContent.trim()));
check('undo restores order', order2[1] === 'Get started in 5 steps' && order2[2] === 'Everything you need');

// 8. Insert panel
await page.click('#hve-tb-insert');
await page.waitForTimeout(200);
check('insert panel opened', await page.evaluate(() => !!document.querySelector('.hve-insert-panel')));
await page.screenshot({ path: '/tmp/shots/03-insert-panel.png' });
const before = await page.evaluate(() => document.querySelectorAll('body p').length);
await page.click('.hve-insert-panel .hve-ip-item >> nth=1'); // Text Box
await page.waitForTimeout(400);
const after = await page.evaluate(() => document.querySelectorAll('body p').length);
check('element inserted via panel', after === before + 1);

// 9. Context menu — scroll target to viewport center (instant) to avoid the fixed toolbar
const h2now = await page.$('main h2');
const centerOn = async (handle) => {
  await handle.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  return handle.boundingBox();
};
let hb = await centerOn(h2now);
const h2pt = { x: hb.x + 60, y: hb.y + Math.floor(hb.height / 2) }; // vertical center — below fixed toolbar
await page.mouse.click(h2pt.x, h2pt.y);
await page.waitForTimeout(100);
await page.mouse.down({ button: 'right' });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(200);
check('context menu opened', await page.evaluate(() => !!document.querySelector('.hve-context-menu')));
const menuText = await page.evaluate(() => document.querySelector('.hve-context-menu')?.textContent || '');
check('context menu has layers+group', menuText.includes('Bring Forward') && menuText.includes('Group'));
await page.screenshot({ path: '/tmp/shots/04-context-menu.png' });
await page.keyboard.press('Escape'); // close context menu
await page.waitForTimeout(100);
await page.mouse.click(1300, 400); // click empty right margin -> marquee click clears selection
await page.waitForTimeout(150);

// 10. Multi-select + group/ungroup
const grids = await page.$$('main div');
let featCards = [];
for (const g of grids) {
  const kids = await g.$$(':scope > div');
  if (kids.length >= 4) { featCards = kids; break; }
}
check('found feature cards', featCards.length >= 4);
if (featCards.length >= 2) {
  const c1 = await centerOn(featCards[0]);
  const c2 = await featCards[1].boundingBox();
  await page.keyboard.down('Control');
  await page.mouse.click(c1.x + 20, c1.y + 20);
  await page.waitForTimeout(100);
  await page.mouse.click(c2.x + 20, c2.y + 20);
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  check('multi-select works', await page.evaluate(() => window.HVE.state.selected.length === 2));
  check('multi toast shown', await page.evaluate(() => document.querySelector('.hve-multi-toast').style.display === 'flex'));
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(200);
  check('group created', await page.evaluate(() => !!document.querySelector('[data-hve-group]')));
  await page.keyboard.press('Control+Shift+g');
  await page.waitForTimeout(200);
  check('ungroup works', await page.evaluate(() => !document.querySelector('[data-hve-group]')));
}

// 11. Lock/unlock
hb = await centerOn(h2now);
await page.mouse.click(hb.x + 60, hb.y + Math.floor(hb.height / 2));
await page.waitForTimeout(150);
await page.keyboard.press('Control+l');
await page.waitForTimeout(150);
check('lock applied', await page.evaluate(() => !!document.querySelector('[data-hve-locked]')));
await page.keyboard.press('Control+l');
await page.waitForTimeout(150);
check('unlock works', await page.evaluate(() => !document.querySelector('[data-hve-locked]')));

// 12. Duplicate + delete
const h2count1 = await page.evaluate(() => document.querySelectorAll('main h2').length);
hb = await centerOn(h2now);
await page.mouse.click(hb.x + 60, hb.y + Math.floor(hb.height / 2));
await page.waitForTimeout(100);
await page.keyboard.press('Control+d');
await page.waitForTimeout(150);
check('duplicate works', await page.evaluate(n => document.querySelectorAll('main h2').length === n + 1, h2count1));
await page.keyboard.press('Delete');
await page.waitForTimeout(150);
check('delete works', await page.evaluate(n => document.querySelectorAll('main h2').length === n, h2count1));

// 13. Color panel
hb = await centerOn(h2now);
await page.mouse.click(hb.x + 60, hb.y + Math.floor(hb.height / 2));
await page.waitForTimeout(150);
check('selection active for color', await page.evaluate(() => window.HVE.state.selected.length === 1));
await page.click('#hve-tb-color');
await page.waitForTimeout(200);
check('color panel opened', await page.evaluate(() => !!document.querySelector('.hve-color-panel')));
await page.screenshot({ path: '/tmp/shots/05-color-panel.png' });
const swatches = await page.$$('.hve-cp-swatch');
await swatches[9].click();
await page.waitForTimeout(150);
check('text color applied', await page.evaluate(() => {
  const s = window.HVE.state.selected[0];
  return s && (s.style.color === '#cc785c' || s.style.color === 'rgb(204, 120, 92)');
}));

// 14. Clean serialization
const clean = await page.evaluate(() => window.HVE.serializeDocument());
check('serialize removes ui root', !clean.includes('hve-ui-root'));
check('serialize removes runtime marks', !/data-hve-(selected|hovered|editing)/.test(clean));
check('serialize removes editor script', !clean.includes('editor.js'));
check('serialize keeps doctype', clean.startsWith('<!DOCTYPE html>'));
check('serialize keeps content edits', clean.includes('REPLACED'));

// 15. Chart panel
await page.click('#hve-tb-chart');
await page.waitForTimeout(200);
check('chart panel opened', await page.evaluate(() => !!document.querySelector('.hve-chart-grid')));
await page.click('.hve-chart-tile:nth-child(1)');
await page.waitForTimeout(300);
check('chart template inserted', await page.evaluate(() => document.body.textContent.includes('Monthly active users')));
await page.screenshot({ path: '/tmp/shots/06-chart.png' });

// 16. Page sorter
await page.click('#hve-tb-pages');
await page.waitForTimeout(250);
check('page sorter opened', await page.evaluate(() => !!document.querySelector('.hve-ps-item')));
check('page sorter lists blocks', await page.evaluate(() => document.querySelectorAll('.hve-ps-item').length >= 2));
await page.screenshot({ path: '/tmp/shots/07-pages.png' });
await page.click('.hve-sp-close');
await page.waitForTimeout(100);

// 17. PDF panel
await page.click('#hve-cb-pdf');
await page.waitForTimeout(200);
check('pdf panel opened', await page.evaluate(() => !!document.querySelector('#hve-pdf-export')));
await page.screenshot({ path: '/tmp/shots/08-pdf.png' });
await page.click('#hve-pdf-breaks');
await page.waitForTimeout(200);
check('break preview lines', await page.evaluate(() => document.querySelectorAll('.hve-pdf-breakline').length >= 1));
await page.click('.hve-sp-close');

// 18. Open file
const testHtml = '<!DOCTYPE html><html><head><title>Loaded Doc</title><style>body{font-family:sans-serif}</style></head><body><h2>Imported Heading</h2><p>Imported paragraph.</p></body></html>';
const chooserP = page.waitForEvent('filechooser');
await page.click('#hve-cb-open');
const chooser = await chooserP;
await chooser.setFiles([{ name: 'loaded.html', mimeType: 'text/html', buffer: Buffer.from(testHtml) }]);
await page.waitForTimeout(400);
check('open replaces content', await page.evaluate(() => document.body.textContent.includes('Imported Heading')));
check('open sets filename', await page.evaluate(() => window.HVE.state.fileName === 'loaded.html'));

// 19. Save As download (edit mode is already on)
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#hve-cb-save')
]);
check('save downloads file', download !== null);
const dlPath = '/tmp/downloaded-page.html';
await download.saveAs(dlPath);
const saved = fs.readFileSync(dlPath, 'utf8');
check('saved file clean of editor', !saved.includes('hve-ui-root') && !saved.includes('editor.js'));
check('saved file has loaded content', saved.includes('Imported Heading'));
check('saved has doctype', saved.startsWith('<!DOCTYPE html>'));

// 20. View mode toggle back
await page.click('#hve-cb-edit');
await page.waitForTimeout(150);
check('view mode restores', await page.evaluate(() => !window.HVE.state.editMode));

await page.screenshot({ path: '/tmp/shots/09-final.png' });

await browser.close();

let fails = 0;
for (const [st, name] of results) if (st === 'FAIL') fails++;
if (errors.length) {
  console.log('\nJS ERRORS:');
  errors.slice(0, 10).forEach(e => console.log('  ', e.slice(0, 200)));
}
console.log('\n' + (results.length - fails) + '/' + results.length + ' passed' + (errors.length ? ' — ' + errors.length + ' js errors' : ''));
process.exit(fails || errors.length ? 1 : 0);
