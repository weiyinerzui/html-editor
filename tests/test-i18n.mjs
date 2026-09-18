import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_URL = 'file://' + path.join(ROOT, 'index.html');

const results = [];
function check(name, cond) { results.push([cond ? 'PASS' : 'FAIL', name]); console.log((cond ? 'PASS' : 'FAIL').padEnd(5), name); }

const browser = await chromium.launch();

/* ---- A. Default language is Chinese (fresh profile) ---- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(PAGE_URL);
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    h1: document.querySelector('main h1').textContent,
    editLabel: document.querySelector('#hve-cb-edit span').textContent,
    status: document.querySelector('#hve-status-text').textContent,
    langBtn: document.querySelector('#hve-cb-lang-label').textContent,
    fontFirstOpt: document.querySelector('#hve-tb-font option').textContent,
    desc: document.querySelector('meta[name="description"]').getAttribute('content'),
    heroSub: document.querySelector('main p').textContent.slice(0, 10),
  }));
  check('default: html lang is zh-CN', state.lang === 'zh-CN');
  check('default: document title is Chinese', state.title.includes('编辑器'));
  check('default: hero heading is Chinese', state.h1.includes('编辑器'));
  check('default: hero paragraph is Chinese', /[\u4e00-\u9fff]/.test(state.heroSub));
  check('default: meta description is Chinese', /[\u4e00-\u9fff]/.test(state.desc));
  check('default: edit button reads 编辑', state.editLabel === '编辑');
  check('default: status pill reads 视图模式', state.status === '视图模式');
  check('default: lang toggle offers EN', state.langBtn === 'EN');
  check('default: font select shows 默认', state.fontFirstOpt === '默认');

  /* ---- B. Switch to English ---- */
  await page.click('#hve-cb-lang');
  await page.waitForTimeout(250);
  const en = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    h1: document.querySelector('main h1').textContent,
    title: document.title,
    editLabel: document.querySelector('#hve-cb-edit span').textContent,
    status: document.querySelector('#hve-status-text').textContent,
    langBtn: document.querySelector('#hve-cb-lang-label').textContent,
    fontFirstOpt: document.querySelector('#hve-tb-font option').textContent,
    heroSub: document.querySelector('main p').textContent.slice(0, 12),
    storage: localStorage.getItem('hve-lang'),
  }));
  check('switch: html lang becomes en', en.lang === 'en');
  check('switch: hero heading back to English', en.h1 === 'Free Online WYSIWYG HTML Editor');
  check('switch: title back to English', en.title.includes('WYSIWYG'));
  check('switch: hero paragraph back to English', /^[A-Za-z]/.test(en.heroSub));
  check('switch: edit button reads Edit', en.editLabel === 'Edit');
  check('switch: status pill reads View mode', en.status === 'View mode');
  check('switch: lang toggle offers 中文', en.langBtn === '中文');
  check('switch: font select shows Default', en.fontFirstOpt === 'Default');
  check('switch: choice persisted', en.storage === 'en');

  /* ---- C. Persistence across reload ---- */
  await page.reload();
  await page.waitForTimeout(400);
  check('reload: English persists', await page.evaluate(() =>
    document.querySelector('main h1').textContent === 'Free Online WYSIWYG HTML Editor' &&
    localStorage.getItem('hve-lang') === 'en'));

  /* ---- D. Switch back to Chinese ---- */
  await page.click('#hve-cb-lang');
  await page.waitForTimeout(250);
  check('switch back: heading Chinese again', await page.evaluate(() =>
    document.querySelector('main h1').textContent.includes('编辑器')));

  /* ---- E. Chinese editor UI: insert panel / dialogs / toasts ---- */
  await page.click('#hve-cb-edit');
  await page.waitForTimeout(200);
  await page.click('#hve-tb-insert');
  await page.waitForTimeout(200);
  const items = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.hve-ip-item b')).map(b => b.textContent));
  check('insert panel items are Chinese', items[0] === '容器' && items[1] === '文本框' && items[2] === '标题');
  const modeBtns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.hve-ip-mode-btn')).map(b => b.textContent));
  check('insert panel modes are Chinese', modeBtns.some(x => x.includes('文档流')) && modeBtns.some(x => x.includes('浮动')));

  // table dialog
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await page.evaluate(() => window.HVE.toggleEditMode(true));
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    // open the table dialog programmatically via the panel is complex; use the API path
    const tb = document.querySelector('#hve-tb-insert');
    tb.click();
  });
  await page.waitForTimeout(150);
  await page.click('.hve-ip-item >> nth=3'); // table
  await page.waitForTimeout(250);
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('.hve-dialog');
    if (!d) return null;
    return {
      title: d.querySelector('h3').textContent,
      labels: Array.from(d.querySelectorAll('label')).map(l => l.textContent),
      buttons: Array.from(d.querySelectorAll('button')).map(b => b.textContent),
    };
  });
  check('table dialog title is Chinese', dlg && dlg.title === '插入表格');
  check('table dialog labels are Chinese', dlg && dlg.labels.includes('行数') && dlg.labels.includes('列数'));
  check('table dialog buttons are Chinese', dlg && dlg.buttons.includes('取消') && dlg.buttons.includes('插入'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // toast in Chinese: duplicate the hero heading
  const h1el = await page.$('main h1');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  const bb = await h1el.boundingBox();
  await page.mouse.click(bb.x + 60, bb.y + bb.height / 2);
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(300);
  const toastText = await page.evaluate(() => {
    const t = document.querySelector('.hve-toast:last-child span:last-child');
    return t ? t.textContent : '';
  });
  check('duplicate toast is Chinese', toastText === '已复制元素');

  // inserted element factory content follows the language
  await page.keyboard.press('Delete'); // remove duplicate h1
  await page.waitForTimeout(200);
  await page.click('#hve-tb-insert');
  await page.waitForTimeout(150);
  await page.click('.hve-ip-item >> nth=5'); // button
  await page.waitForTimeout(300);
  const btnText = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter(b => b.closest('body') && !b.hasAttribute('data-hve-ui') && !b.closest('.hve-toolbar'));
    return btns.map(b => b.textContent.trim()).find(x => x === '点我' || x === 'Click Me');
  });
  check('inserted button text follows language (点我)', btnText === '点我');

  // context menu in Chinese
  const h2b = (await page.$$('main h2'))[1];
  await h2b.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  const hb = await h2b.boundingBox();
  await page.mouse.move(hb.x + 60, hb.y + hb.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(200);
  const ctx = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.hve-cm-item span:nth-child(2)')).map(s => s.textContent));
  check('context menu is Chinese', ctx.includes('编辑文字') && ctx.includes('锁定元素') && ctx.includes('删除'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  // side panel titles in Chinese
  await page.click('#hve-tb-pages');
  await page.waitForTimeout(200);
  check('page sorter panel title is Chinese', await page.evaluate(() => {
    const el = document.querySelector('.hve-sp-title');
    return el ? el.textContent === '页面管理器' : false;
  }));
  await page.click('#hve-tb-chart');
  await page.waitForTimeout(200);
  check('chart panel title is Chinese', await page.evaluate(() => {
    const el = document.querySelector('.hve-sp-title');
    return el ? el.textContent === '图表排版' : false;
  }));
  check('chart tiles are Chinese', await page.evaluate(() =>
    Array.from(document.querySelectorAll('.hve-ct-name')).some(n => n.textContent === '数据卡片')));

  // serialized document keeps Chinese content and stays clean
  const saved = await page.evaluate(() => window.HVE.serializeDocument());
  check('serialized doc has Chinese content', saved.includes('免费在线可视化 HTML 编辑器'));
  check('serialized doc is clean of editor UI', !saved.includes('data-hve-ui') && !saved.includes('hve-controlbar'));

  check('no page errors (suite A–E)', errors.length === 0);
  if (errors.length) console.log('   ', errors.join(' | '));
  await page.close();
}

/* ---- F. English remembered from a previous session ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // seed the language before the page ever loads
  await ctx.addInitScript(() => { try { localStorage.setItem('hve-lang', 'en'); } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(PAGE_URL);
  await page.waitForTimeout(400);
  check('seeded English: heading is English', await page.evaluate(() =>
    document.querySelector('main h1').textContent === 'Free Online WYSIWYG HTML Editor'));
  check('seeded English: edit button reads Edit', await page.evaluate(() =>
    document.querySelector('#hve-cb-edit span').textContent === 'Edit'));
  await ctx.close();
}

await browser.close();

const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
