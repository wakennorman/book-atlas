// 验证 v0.96 的「截断文字悬停/聚焦弹全文」：
//   ① 页面上确实存在被 CSS 剪掉、但完整文案还在 DOM 里的元素（这是功能的前提）
//   ② mouseover ⇒ 浮层出现，且显示的是**完整**文案（包含被剪掉的那截）
//   ③ mouseout ⇒ 浮层消失；Esc 也能关（WCAG 2.1 SC 1.4.13 的"可关闭"）
//   ④ focusin 同样能弹（触屏没有 hover，纯 hover 方案对触屏等于没有）
//   ⑤ **没被剪掉的元素不弹**（负向测试：防止"什么都弹"把页面搞得很吵）
//   ⑥ 浮层落在视口内（地点浮层曾栽在这上面：目标在视口外时浮层被放到 top=1050）
//
// 端口用 listen(0) 拿临时端口 —— 10 个老测试写死了端口（roam 19135 之类），
// 那也是用户误开测试服务器的原因，见 tools/preview.mjs 顶部说明。
import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) { console.error('no browser'); process.exit(0); }

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon' };
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
const PORT = await new Promise((r) => server.listen(0, () => r(server.address().port)));
const CDP_PORT = await freePort();
sweepStaleProfiles();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-tip-'));
const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
/* ⚠ 预算从 40 次 ×250ms（10 秒）提到 150 次（**37 秒**），并在超时时**明确报错**。
 *   实测：单独跑本测试 exit=0，但在 `npm run gate` 的串行负载下（前面已连续跑过
 *   十几个开浏览器的步骤）Edge 迟迟不暴露 CDP 端点，10 秒预算耗尽后
 *   `new WebSocket(null)` 抛错 —— 而门禁只打印含 ✗ 的行，于是这一步只显示
 *   「exit=1 红 0」，**看不出是超时还是断言失败**，排查很绕。
 *   （`test/` 里其余测试还是 40 次的旧预算，改它们和端口改造一起做。） */
let url = null;
for (let i = 0; i < 150 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
if (!url) { console.error('  ✗ 连不上 Edge 的 CDP 端点（等了 37 秒）—— 这是**环境/负载**问题，不是断言失败'); process.exit(1); }
const ws = new WebSocket(url);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, 25000); });
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

/* 页面内小工具：派发真实事件 / 读浮层状态。都注入到页面里，避免来回传大对象。
 *
 * ⚠ 全部用 `window.__tip.` 显式引用，**不用 `this`**。
 *   第一版写成 `this.sel` / `this.tip()`：对象字面量的方法里 `this` 指向
 *   `window.__tip` 没错，但**箭头函数**捕获的是外层作用域的 `this`，也就是 `window` ——
 *   而 `sel` 挂在 `window.__tip` 上，`window.sel` 是 undefined。
 *   ⇒ `document.querySelectorAll(undefined)` 把 "undefined" 当类型选择器，匹到零个元素，
 *   `firstClipped()` 静悄悄返回 null，② ③ ④ 全部连锁失败（而 ① 因为直接写了
 *   `window.__tip.sel` 反而通过了 ⇒ 看起来像"功能时好时坏"）。
 */
const HELPERS = `
window.__tip = {
  sel: '.ch-list li > .linkbtn, .event-chip .ev-sum, [data-tip-full]',
  tip: () => document.querySelector('.place-tip.full-tip'),
  state: () => {
    const t = window.__tip.tip();
    if (!t) return { exists: false };
    const r = t.getBoundingClientRect();
    return { exists: true, hidden: t.hidden, text: t.textContent.trim(),
             inViewport: r.top >= -1 && r.left >= -1
               && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1,
             top: Math.round(r.top), left: Math.round(r.left) };
  },
  over: (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })),
  focus: (el, type) => el.dispatchEvent(new FocusEvent(type, { bubbles: true })),
  clipped: (e) => !!e && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1),
  // 页面上第一个"真的被剪掉"的元素；顺带报数量，避免"返回 null 却不知道为什么"
  all: () => [...document.querySelectorAll(window.__tip.sel)],
  firstClipped: () => window.__tip.all().find((e) => window.__tip.clipped(e)) || null,
};
`;

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=one-hundred-years-of-solitude` });
  for (let i = 0; i < 300; i++) { if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book)`).catch(() => false)) break; await wait(100); }
  await wait(2500);
  /* ⚠ 必须先关掉剧透保护。不关的话时间轴上全是**锁着**的芯片，
   * 它们的 .ev-sum 是一句短的「剧透保护中 · 读到再解锁」⇒ 一个都不会被剪掉，
   * 于是「页面上有被剪掉的元素」这条断言必然失败（第一版就栽在这，4 秒就挂）。
   * 顺便说：这个失败信息（"找不到被剪掉的元素"）本身指向的前提是**测试没把页面摆到该有的状态**，
   * 而不是功能坏了 —— 和 place-visible 那条「必须重载页面」是同一类纪律。 */
  await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`).catch(() => {});
  await wait(1800);
  await js(HELPERS);

  console.log('\n▶ ① 前提：页面上真的有"被剪掉但文案还在"的事件摘要');
  const inv = await js(`(() => {
    const all = window.__tip.all();
    const clipped = all.filter((e) => window.__tip.clipped(e));
    const full = all.filter((e) => (e.dataset.tipFull || e.textContent || '').trim().length > 0);
    return { total: all.length, clipped: clipped.length, withText: full.length,
             sel: window.__tip.sel,
             firstClipText: clipped[0] ? clipped[0].textContent.trim().slice(0, 46) : null };
  })()`);
  console.log(`    选择器 ${inv.sel}`);
  console.log(`    命中 ${inv.total} 个元素，其中被剪掉 ${inv.clipped} 个；样本：「${inv.firstClipText}…」`);
  ok(inv.total >= 10, `选择器命中足够多（${inv.total} 个）`);
  ok(inv.clipped > 0, `页面上有被剪掉的元素（${inv.clipped} 个）——功能前提`);

  console.log('\n▶ ② 悬停 ⇒ 弹全文（且比可见的长）');
  const hov = await js(`(() => {
    const el = window.__tip.firstClipped();
    if (!el) return { no: true };
    const full = (el.dataset.tipFull || el.textContent).trim();
    window.__tip.over(el, 'mouseover');
    const s = window.__tip.state();
    return { full, tipText: s.text, hidden: s.hidden, inViewport: s.inViewport,
             aria: el.getAttribute('aria-describedby'), tipId: s.exists ? (window.__tip.tip().id || '') : '' };
  })()`);
  if (!hov.no) {
    const tipLen = (hov.tipText || '').length;
    console.log(`    原文 ${hov.full.length} 字：${hov.full.slice(0, 40)}…`);
    console.log(`    浮层 ${tipLen} 字，在视口内=${hov.inViewport}`);
    ok(hov.hidden === false, 'mouseover 后浮层不是 hidden');
    ok(hov.tipText === hov.full, '浮层文字**等于完整文案**（不是被剪掉的那一截）');
    ok(tipLen > 28, `浮层文字确实够长（${tipLen} 字 > 单行 clamp 能显示的量）`);
    ok(hov.inViewport, '浮层落在视口内（不是在屏幕外）');
    ok(hov.aria === 'full-tip' && hov.tipId === 'full-tip', `aria-describedby 指向浮层（=${hov.aria}），读屏能读到`);
  } else ok(false, '页面上找不到被剪掉的元素（① 已失败）');

  console.log('\n▶ ③ 移开 ⇒ 消失；Esc 也能关（WCAG 1.4.13 的"可关闭"）');
  const out = await js(`(() => {
    const el = window.__tip.firstClipped();
    window.__tip.over(el, 'mouseout');
    const afterOut = window.__tip.state();
    window.__tip.over(el, 'mouseover');
    const reopened = window.__tip.state();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const afterEsc = window.__tip.state();
    return { afterOut: afterOut.hidden, reopened: reopened.hidden, afterEsc: afterEsc.hidden };
  })()`);
  ok(out.afterOut === true, 'mouseout 后浮层隐藏');
  ok(out.reopened === false, '再次悬停能重新弹出（不是一次性）');
  ok(out.afterEsc === true, 'Esc 能关掉浮层');

  console.log('\n▶ ④ 键盘 focus 同样能弹（触屏没有 hover）');
  const foc = await js(`(() => {
    const el = window.__tip.firstClipped();
    window.__tip.focus(el, 'focusin');
    const on = window.__tip.state();
    window.__tip.focus(el, 'focusout');
    return { on: on.hidden, text: on.text };
  })()`);
  ok(foc.on === false, 'focusin 会弹出（键盘/读屏用户拿得到全文）');
  ok((foc.text || '').length > 28, 'focus 弹出的是完整文案');
  const afterFoc = await js(`window.__tip.state().hidden`);
  ok(afterFoc === true, 'focusout 后隐藏');

  console.log('\n▶ ⑤ 负向：**没被剪掉的元素不弹**（否则页面会变得很吵）');
  const neg = await js(`(() => {
    // 造两个确定性样本：短文本、够窄所以一定被剪的长文本
    const mk = (text, narrow) => {
      const d = document.createElement('div');
      d.setAttribute('data-tip-full', text);
      d.textContent = text;
      d.style.cssText = 'position:fixed;left:10px;top:10px;background:#fff;'
        + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px sans-serif;';
      if (narrow) d.style.width = '60px';
      document.body.appendChild(d);
      return d;
    };
    const short = mk('短', false);              // 不窄 ⇒ 不该被剪 ⇒ 不该弹
    const long = mk('这是一段很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长的文字', true);
    window.__tip.over(short, 'mouseover');
    const shortShown = window.__tip.state().hidden === false;
    window.__tip.over(short, 'mouseout');
    window.__tip.over(long, 'mouseover');
    const longShown = window.__tip.state().hidden === false;
    window.__tip.over(long, 'mouseout');
    const r = { shortShown, longShown,
      shortClipped: window.__tip.clipped(short),
      longClipped: window.__tip.clipped(long) };
    short.remove(); long.remove();
    return r;
  })()`);
  console.log(`    短样本被剪=${neg.shortClipped}  长样本被剪=${neg.longClipped}`);
  ok(neg.longClipped === true, '长样本确实被剪掉了（否则这个负向测试没意义）');
  ok(neg.shortShown === false, '未被剪掉的元素**不弹**浮层');
  ok(neg.longShown === true, '被剪掉的元素会弹（同一套判据的正向对照）');

  console.log('\n▶ ⑥ 两类浮层各管各的，不会同时弹出来');
  /* ⚠ 这一条第一版写成"事件摘要里嵌着地点名时收掉地点浮层"，方向错了：
   *   地点引用渲染在**兄弟节点 `.ev-name`** 里（而且 `.ev-name` 没有被截断），
   *   `.ev-sum` 里根本不可能有 `[data-place-id]` —— 实测 31 张芯片里 0 张有。
   *   所以那个"两层叠在一起"的场景在当前结构下**不可达**，
   *   测试自然就一直"跳过"，而报告里只写一行"（跳过：…）"，看着像没问题。
   *
   *   改成断言**真实存在**的分离行为（这才是用户能看见的）：
   *   悬停事件名里的地点 ⇒ 只弹地点浮层，且**不**弹全文浮层；
   *   悬停摘要 ⇒ 只弹全文浮层。
   *
   *   app.js 里那句 `if (ev.target.closest('[data-place-id]')) hidePlaceTip();`
   *   是**防御性**的（当前结构下走不到），但留着：将来谁把地点引用挪进 .ev-sum
   *   （比如想让整张卡片只弹一个浮层），它就是必要的。别当冗余删掉。 */
  const both = await js(`(() => {
    const placeTipEl = () => [...document.querySelectorAll('.place-tip')].find((t) => !t.classList.contains('full-tip'));
    const ref = document.querySelector('.event-chip [data-place-id]')
      || document.querySelector('[data-place-id]');
    if (!ref) return { skip: true };
    // ① 悬停地点名 ⇒ 地点浮层出现，全文浮层**不**出现
    ref.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const placeShown = !!(placeTipEl() && !placeTipEl().hidden);
    const fullWhilePlace = window.__tip.state().hidden === false;
    ref.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    // ② 悬停摘要 ⇒ 全文浮层出现
    const chip = document.querySelector('.event-chip .ev-sum');
    window.__tip.over(chip, 'mouseover');
    const fullShown = window.__tip.state().hidden === false;
    window.__tip.over(chip, 'mouseout');
    return { skip: false, placeShown, fullWhilePlace, fullShown, refText: ref.textContent.trim().slice(0, 20) };
  })()`);
  if (both.skip) console.log('    （跳过：这一页一个地点引用都没有）');
  else {
    console.log(`    样本地点：「${both.refText}」`);
    ok(both.placeShown === true, '悬停事件名里的地点 ⇒ 地点浮层出现（地点浮层本身没坏）');
    ok(both.fullWhilePlace === false, '此时**不**弹全文浮层（两个浮层不同时出现）');
    ok(both.fullShown === true, '悬停摘要 ⇒ 全文浮层出现');
  }

  console.log(`\n${failed ? '✗' : '✓'} 截断文字的全文浮层：${passed} 通过，${failed} 失败`);
} catch (e) { failed++; console.error('异常：' + e.message); }
releaseProfile(profile);
process.exit(failed ? 1 : 0);
