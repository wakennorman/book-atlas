// v93：地点介绍
//  ① 地点筛选从原生 <select> 换成自建 combo（原生 option 由操作系统绘制，挂不上 tooltip）
//  ② 下拉里每行带「类型 · 第N章」，**当前行**（悬停或 ↑↓）额外显示介绍
//  ③ 页面别处的地点名：悬停/聚焦弹出说明浮层，且满足 WCAG 2.1 SC 1.4.13（可关闭/可悬停/持久/键盘可达）
//  ④ 每个地点都有介绍（数据完整性）
import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';
import { requireBrowser } from './_browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon' };
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
server.on('error', (e) => { console.error('静态服务器起不来：' + e.message); process.exit(1); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const EDGE = requireBrowser();
const CDP_PORT = await freePort();   // v0.97：不再需要 BA_CDP_SEQ 错开
sweepStaleProfiles();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-place-'));
const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
/* ⚠ 连不上 CDP 时必须**在这里**报错退出，不能往下走。
 *
 * 下面是 `new WebSocket(url)` 加一个只监听 onopen/onerror 的 promise ——
 * url 拿不到时它是 null，连不上时那个 promise **永远不 settle**，
 * 于是进程静默挂死：stdout / stderr **0 字节**，没有异常、没有退出码，
 * 看起来像"卡在某个断言上"，其实一条断言都还没开始跑。
 * 实测在门禁里撞过两次，每次要等十几分钟超时才发现。
 * （v0.100 把这道防线补齐到所有走 CDP 的测试文件。）
 */
if (!url) {
  console.error('  ✗ Edge 起来后连不上 CDP 端点 —— 这是**环境/负载**问题，不是断言失败。');
  console.error('    多半是刚借到的临时端口被别的进程抢走了（借出到 Edge 抢占之间有个毫秒级窗口，');
  console.error('    见 test/_free-port.mjs 的说明）—— 重跑一次通常就好。');
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  releaseProfile(profile);
  process.exit(1);
}

const ws = new WebSocket(url);
await Promise.race([

  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }),

  new Promise((_, rej) => setTimeout(() => rej(new Error('CDP WebSocket 10 秒内没连上')), 10000)),

]);
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); } };
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, 40000);
});
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
  for (let i = 0; i < 300; i++) { if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length>500)`).catch(() => false)) break; await wait(100); }
  await wait(2500);
  await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`).catch(() => {});
  await wait(1500);

  console.log('▶ ① 每个地点都有介绍（数据完整性）');
  const data = await js(`(() => {
    const ps = window.__ba.state.book.places || [];
    return { n: ps.length, withDesc: ps.filter((p) => (p.desc || '').trim()).length, withType: ps.filter((p) => p.type).length };
  })()`);
  console.log(`    地点 ${data.n} 个`);
  ok(data.n > 0, `书里有地点数据（${data.n} 个）`);
  ok(data.withDesc === data.n, `每个地点都有介绍（${data.withDesc}/${data.n}）`);
  ok(data.withType === data.n, `每个地点都有类型（${data.withType}/${data.n}）`);

  console.log('\n▶ ② 地点筛选不再是原生 <select>（原生 option 挂不上 tooltip）');
  const ctl = await js(`(() => {
    const e = document.getElementById('place-filter');
    return { tag: e.tagName, role: e.getAttribute('role'), controls: !!document.getElementById(e.getAttribute('aria-controls')),
             listHidden: document.getElementById('place-filter-combo-list') ? document.getElementById('place-filter-combo-list').hidden : null };
  })()`);
  console.log(`    ${JSON.stringify(ctl)}`);
  ok(ctl.tag === 'INPUT', `是 <input> 而不是 <select>（实际 ${ctl.tag}）`);
  ok(ctl.role === 'combobox', 'role=combobox');
  ok(ctl.controls, 'aria-controls 指向真实存在的下拉列表');

  console.log('\n▶ ③ 下拉里每行有「类型 · 第N章」，当前行额外显示介绍');
  /* 用「输入」打开下拉，而不是靠 focus()。
     无头环境下 el.focus() 不保证派发 focus 事件（第一版就这么写的，结果下拉根本没开，
     后面 7 条断言全在 undefined 上空转）。而 attachCombo 本来就监听 input，
     这也才是用户真实的动作路径。三国 303 个地点，必须先筛出几个才看得清每一行长什么样。 */
  await js(`(() => { const e = document.getElementById('place-filter'); e.value = '城'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(400);
  const list = await js(`(() => {
    const L = document.getElementById('place-filter-combo-list');
    if (!L || L.hidden) return { open: false };
    const items = [...L.querySelectorAll('.combo-item[data-i]')];
    const on = L.querySelector('.combo-item.on');
    const desc = on ? on.querySelector('.combo-desc') : null;
    return { open: true, n: items.length,
             first: items[0] ? { text: items[0].textContent.trim(), hasSub: !!items[0].querySelector('.combo-sub'), hasDesc: !!items[0].querySelector('.combo-desc') } : null,
             onText: on ? on.textContent.trim() : null,
             onDesc: desc ? desc.textContent.trim() : null,
             onDescVisible: desc ? getComputedStyle(desc).display !== 'none' : false,
             otherDescVisible: (() => { const o = [...items].find((i) => !i.classList.contains('on')); const d = o && o.querySelector('.combo-desc'); return d ? getComputedStyle(d).display !== 'none' : null; })() };
  })()`);
  console.log(`    首行：${list.first ? JSON.stringify(list.first.text) : '—'}（共 ${list.n} 行）`);
  console.log(`    当前行：${JSON.stringify(list.onText)}`);
  ok(list.open, '输入后下拉打开');
  ok(list.n >= 1 && list.n < 60, `「城」筛出 ${list.n} 个地点（上限 60，超出会提示还有多少）`);
  ok(list.first && list.first.hasSub, '每行都带「类型 · 第N章」副标题');
  ok(list.first && list.first.hasDesc, '每行都带介绍（只是默认收起，不是不存在）');
  ok(list.onDesc && list.onDesc.length > 0, `当前行的介绍有内容：「${list.onDesc}」`);
  ok(list.onDescVisible, '当前行的介绍**默认就是显示的**');
  ok(list.otherDescVisible === false, '非当前行的介绍是收起的（一次只显示一条，不是 303 条糊满下拉）');

  console.log('\n▶ ④ 悬停也能让某一行成为当前行（鼠标用户看不到说明就白做了）');
  const hov = await js(`(() => {
    const L = document.getElementById('place-filter-combo-list');
    const items = [...L.querySelectorAll('.combo-item[data-i]')];
    const target = items[3];
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const on = L.querySelector('.combo-item.on');
    const d = on && on.querySelector('.combo-desc');
    return { moved: on === target, onText: on ? on.textContent.trim() : null,
             descVisible: d ? getComputedStyle(d).display !== 'none' : false,
             ariaActive: document.getElementById('place-filter').getAttribute('aria-activedescendant') };
  })()`);
  ok(hov.moved, `悬停第 4 行后它成为当前行：${JSON.stringify(hov.onText)}`);
  ok(hov.descVisible, '悬停行的介绍随即显示');
  ok(!!hov.ariaActive && hov.ariaActive.endsWith('-i3'), `aria-activedescendant 也跟着走（${hov.ariaActive}）`);

  console.log('\n▶ ⑤ 选中一个地点 ⇒ 真的筛选了（且建锁）');
  const picked = await js(`(() => {
    const L = document.getElementById('place-filter-combo-list');
    const it = [...L.querySelectorAll('.combo-item[data-i]')][2];
    const name = it.querySelector('b').textContent.trim();
    it.click();
    return name;
  })()`);
  await wait(2200);
  const applied = await js(`(() => { const st = window.__ba.state;
    return { filter: st.placeFilter, name: document.getElementById('place-filter').value,
             lockOrigin: st.clickLock && st.clickLock.origin, panel: (document.getElementById('panel').innerText || '').slice(0, 60) }; })()`);
  console.log(`    选了「${picked}」→ filter=${applied.filter} 输入框显示「${applied.name}」锁=${applied.lockOrigin}`);
  ok(applied.filter, `按地点筛选生效（placeFilter=${applied.filter}）`);
  ok(applied.name === picked, `输入框显示的是选中的地名（「${applied.name}」）`);
  ok(applied.lockOrigin === 'place', `地点筛选也建锁（origin=${applied.lockOrigin}）`);
  ok(/📍/.test(applied.panel), '右栏出现地点卡（介绍 + 在这里发生的事）');

  console.log('\n▶ ⑥ 清空输入框 ⇒ 取消筛选');
  await js(`(() => { const e = document.getElementById('place-filter'); e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(1200);
  ok(await js(`window.__ba.state.placeFilter === null`), '筛选已取消');

  console.log('\n▶ ⑦ 页面别处的地点名：悬停弹说明，且满足 WCAG 1.4.13');
  // 找一个真实渲染出来的地点名（章节摘要的地点 chip）
  const found = await js(`(() => {
    const el = document.querySelector('#panel [data-place-id], .ch-chips [data-place-id]');
    if (el) return { inPanel: true, id: el.dataset.placeId };
    window.__ba.goChapter(3); return null;
  })()`).catch(() => null);
  let ref = found;
  if (!ref) {
    await js(`window.__ba.goChapter(3)`).catch(() => {});
    await wait(1200);
    ref = await js(`(() => { const el = document.querySelector('[data-place-id]'); return el ? { id: el.dataset.placeId } : null; })()`);
  }
  ok(!!ref, `页面里存在带 data-place-id 的地点名（${ref && ref.id}）`);

  const tip = await js(`(() => {
    const el = document.querySelector('[data-place-id]');
    if (!el) return { none: true };
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const t = document.querySelector('.place-tip');
    if (!t) return { noTip: true };
    const r = t.getBoundingClientRect();
    return { hidden: t.hidden, role: t.getAttribute('role'), id: t.id,
             text: t.innerText.trim().replace(/\\s+/g, ' ').slice(0, 90),
             pe: getComputedStyle(t).pointerEvents,
             rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
             vw: window.innerWidth, vh: window.innerHeight, scrollY: Math.round(window.scrollY),
             onScreen: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
             describedby: el.getAttribute('aria-describedby') };
  })()`);
  console.log(`    浮层内容：${JSON.stringify(tip.text)}`);
  console.log(`    浮层位置 ${JSON.stringify(tip.rect)} / 视口 ${tip.vw}×${tip.vh} scrollY=${tip.scrollY}`);
  ok(!tip.hidden, '悬停后浮层出现');
  ok(tip.role === 'tooltip' && tip.id === 'place-tip', 'role=tooltip 且 id 正确');
  ok(/首次出现/.test(tip.text || ''), '浮层里有「首次出现：第N章」');
  ok(tip.describedby === 'place-tip', '同时挂上 aria-describedby（读屏能念）');
  ok(tip.pe === 'auto', '浮层 pointer-events:auto —— 指针能移进去、字能选中（WCAG「可悬停」）');
  ok(tip.onScreen, '浮层完整落在视口内（没被裁掉）');

  console.log('\n▶ ⑧ WCAG 1.4.13：Esc 可关闭 / 指针移开自动关');
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(200);
  ok(await js(`document.querySelector('.place-tip').hidden === true`), 'Esc 能关闭浮层（不靠移开指针）');
  const again = await js(`(() => { const el = document.querySelector('[data-place-id]');
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const t = document.querySelector('.place-tip'); const shown = !t.hidden;
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }));
    return { shown, after: t.hidden, aria: el.getAttribute('aria-describedby') }; })()`);
  ok(again.shown && again.after, '再悬停会出来，移开后收起');
  ok(again.aria === null, '收起时 aria-describedby 也摘掉（不指向已隐藏的浮层）');

  console.log('\n▶ ⑨ 键盘也能看到介绍（触屏没有 hover，纯 hover 等于没有）');
  const kbd = await js(`(() => { const el = document.querySelector('[data-place-id]');
    if (!el) return { none: true };
    el.focus();
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    return { shown: !document.querySelector('.place-tip').hidden }; })()`);
  ok(kbd.shown, 'focus 时同样弹出说明');

  console.log(`\n${failed ? '✗' : '✓'} 地点介绍：${passed} 通过，${failed} 失败`);
} catch (e) { failed++; console.error('异常：' + e.message); }
finally {
  try { ws.close(); } catch { }
  try { proc.kill(); } catch { }
  try { server.close(); } catch { }
  releaseProfile(profile);
}
if (passed + failed === 0) { console.error('✗ 一条断言都没跑到（中途崩了？）'); process.exit(1); }
process.exit(failed ? 1 : 0);