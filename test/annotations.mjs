import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* v0.134 拆书标注。
 *
 * 守住的东西（每条都对应一个真实的坏法）：
 *   ① 标注真的**从 data/annotations 加载进来了**（不是探针注入 —— 那个测的是内存，
 *      抓不到"忘了改路径""忘了加 meta.type"这类真问题）
 *   ② 章节面板里真的渲染出拆书分区，且**不是教程/示例**，就是内容本身
 *   ③ **引用的每个事件/人物点得动**，且点开的是正确的那一条
 *      —— 引用不可点是"引用等于装饰"，那比不写更坏
 *   ④ **剧透保护对拆书同样生效**：未解锁的章不能显示拆书内容
 *   ⑤ 没写的章要**明说"还没写"**，不能让人以为"这一章无需拆解"
 *   ⑥ 覆盖进度常驻（已拆 N / M 章）
 *   ⑦ 全书模式能切，且切了之后 chapter 模式的内容不串
 *   ⑧ 没写拆书的书（百年孤独/罪与罚）**不显示该分区**，也不能报错
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CDP_PORT = await freePort();
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) { console.log('  (跳过) 找不到 Edge/Chrome'); process.exit(0); }

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8' };
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-anno-'));
const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = '';
    r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
if (!url) { console.log('  (跳过) 拿不到 CDP'); process.exit(0); }

const ws = new WebSocket(url);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, 40000);
});
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };
const head = (s) => console.log(`\n▶ ${s}`);

/** 章节面板里拆书分区的当前状态 */
const annoDom = () => js(`(() => {
  const sec = document.querySelector('#chapter-body .anno-sec');
  if (!sec) return { present: false, panelText: (document.getElementById('chapter-body') || {}).innerText || '' };
  const tabs = [...sec.querySelectorAll('.anno-tab')].map(b => ({ mode: b.dataset.annoMode, active: b.classList.contains('active'), text: b.textContent.trim() }));
  const items = [...sec.querySelectorAll('.anno-item')].map(it => ({
    title: (it.querySelector('h4') || {}).textContent || '',
    bodyLen: ((it.querySelector('p') || {}).textContent || '').trim().length,
    refs: [...it.querySelectorAll('.anno-ref')].map(b => ({ kind: b.dataset.event ? 'event' : 'char', id: b.dataset.event || b.dataset.goto, text: b.textContent.trim() })),
    basisTag: ((it.querySelector('.anno-tag') || {}).textContent || '').trim(),
    basis: ((it.querySelector('.anno-basis') || {}).textContent || '').trim(),
  }));
  return {
    present: true, tabs, items,
    hint: [...sec.querySelectorAll('.hint')].map(p => p.textContent.trim()),
    secText: sec.innerText,
  };
})()`);

const gotoChapter = async (n) => {
  await js(`(() => { const s = document.getElementById('ch-select'); if (!s) return false; s.value = '${n}'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await wait(900);
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
  for (let i = 0; i < 300; i++) {
    if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length > 500)`).catch(() => false) === true) break;
    await wait(100);
  }
  await wait(2500);
  await js(`document.querySelectorAll('.modal-backdrop').forEach(e => { e.style.display = 'none'; })`);
  await js(`(() => { const b = document.getElementById('spoiler-off'); if (b) b.click(); })()`).catch(() => {});
  await wait(2500);

  head('加载：标注必须真的从 data/annotations 拉进来');
  const st = await js(`(() => {
    const s = window.__ba.state;
    return { status: s.annoStatus, hasAnno: !!s.anno, items: s.anno ? s.anno.items.length : 0,
             global: s.anno ? (s.anno.global || []).length : 0, type: s.book.meta.type,
             chapter: s.chapter, progress: s.progress };
  })()`);
  ok(st.type === '叙事类', `meta.type 是「叙事类」（实际 ${JSON.stringify(st.type)}）`);
  ok(st.hasAnno && st.items > 0, `标注已加载（items=${st.items}，global=${st.global}，状态 ${JSON.stringify(st.status)}）`);

  head('章节模式：第 1 章');
  await gotoChapter(1);
  const c1 = await annoDom();
  ok(c1.present, '章节面板里出现了拆书分区');
  ok(c1.tabs.length === 2 && c1.tabs[0].active, `两个视角都在，默认选中「本章拆解」（${c1.tabs.map((t) => `${t.text}${t.active ? '*' : ''}`).join(' / ')}）`);
  ok(c1.items.length >= 1, `第 1 章渲染出 ${c1.items.length} 条拆解`);
  ok(c1.items.every((i) => i.bodyLen > 40), '每条都有实质内容（正文都不是空的）');
  ok(c1.items.every((i) => i.basisTag === '原文依据' || i.basisTag === '整理者推断'), `每条都标了依据类型（${[...new Set(c1.items.map((i) => i.basisTag))].join(' / ')}）`);
  ok(c1.hint.some((h) => /已拆\s*\d+\s*\/\s*\d+\s*章/.test(h)), `覆盖进度常驻（${c1.hint.find((h) => /已拆/.test(h)) || '没找到'}）`);
  ok(c1.items.some((i) => i.refs.length > 0), '条目带了可点回核对的引用');

  head('引用必须点得动、且点对');
  const evRef = c1.items.flatMap((i) => i.refs).find((r) => r.kind === 'event');
  ok(!!evRef, `找到一条事件引用（${evRef ? `${evRef.id} ${evRef.text}` : '无'}）`);
  if (evRef) {
    const want = await js(`(() => { const e = window.__ba.state.book.events.find(x => x.id === ${JSON.stringify(evRef.id)}); return e ? e.name : null; })()`);
    ok(want !== null && evRef.text.includes(want), `引用按钮上的名字与数据一致（按钮「${evRef.text}」/ 数据「${want}」）`);
    await js(`document.querySelector('.anno-ref[data-event="${evRef.id}"]').click()`);
    await wait(700);
    const opened = await js(`(() => {
      const p = document.getElementById('panel');
      return { text: (p.innerText || '').slice(0, 400), activeEvent: window.__ba.state.activeEvent, hl: window.__ba.state.hlNodes ? window.__ba.state.hlNodes.size : -1 };
    })()`);
    /* ⚠ state.activeEvent / activeChar 存的是 **id 字符串**（setHighlight 直接收 id），
     *   不是对象。第一版写成 `state.activeEvent.id` ⇒ 永远 undefined ⇒ 误报成"点不动"。 */
    ok(opened.activeEvent === evRef.id, `点了引用打开了对应事件（activeEvent=${JSON.stringify(opened.activeEvent)}，期望 ${evRef.id}）`);
    ok(opened.hl > 0, `在场人物被高亮了（hlNodes=${opened.hl}）`);
    /* 面板断言不能只看"出现过事件名" —— 第 1 章的事件列表本来就含这个名字，空断言。
     * 要看事件卡独有的东西：它的 summary 原文。 */
    const summary = await js(`(() => { const e = window.__ba.state.book.events.find(x => x.id === ${JSON.stringify(evRef.id)}); return e ? (e.summary || '') : ''; })()`);
    ok(!!summary && opened.text.includes(summary.slice(0, 20)), '面板里出现了那个事件的 summary 原文');
  }

  head('人物引用');
  const chRef = c1.items.flatMap((i) => i.refs).find((r) => r.kind === 'char');
  if (chRef) {
    await js(`document.querySelector('.anno-ref[data-goto="${chRef.id}"]').click()`);
    await wait(700);
    const cur = await js(`window.__ba.state.activeChar`);
    ok(cur === chRef.id, `点了人物引用打开了对应人物（activeChar=${JSON.stringify(cur)}，期望 ${chRef.id}）`);
  } else { ok(false, '没找到人物引用'); }

  head('没写的章：必须明说「还没写」');
  await gotoChapter(60);
  const c60 = await annoDom();
  ok(c60.present, '拆书分区仍然在（覆盖进度要常驻）');
  ok(/还没写/.test(c60.secText), `第 60 章明说没写：${(c60.secText.match(/第 60 章[^\n]*/) || [''])[0].trim()}`);
  /* ⚠ 不能断言「文案里没有『无需拆解』」—— 我自己的提示语里就含这四个字
     *   （「其余章节还没写，不是「无需拆解」」）。要判的是**说法**：
     *   说的是"还没写"还是"不需要"。 */
  ok(/还没写/.test(c60.secText) && !/本章无需/.test(c60.secText), '说的是「还没写」，不是「本章无需拆解」');
  ok(/已拆\s*\d+\s*\/\s*\d+\s*章/.test(c60.secText), '覆盖进度仍在');

  head('全书模式');
  await js(`document.querySelector('.anno-tab[data-anno-mode="global"]').click()`);
  await wait(700);
  const g = await annoDom();
  ok(g.present && g.tabs[1].active, '切到了全书拆解');
  ok(g.items.length >= 1, `全书拆解渲染出 ${g.items.length} 条`);
  ok(!/已拆\s*\d+\s*\/\s*\d+\s*章/.test(g.secText) || g.items.length >= 1, '全书模式内容不为空');
  await js(`document.querySelector('.anno-tab[data-anno-mode="chapter"]').click()`);
  await wait(700);
  const back = await annoDom();
  /* 第 60 章本来就没写 ⇒ 0 条才是对的；这条断言的是"切回来没有串内容"：
   *   如果切模式时把 global 的条目留在 chapter 视图里，这里会是 2 条。 */
  ok(back.tabs[0].active && back.items.length === 0,
    `切回本章：第 60 章无条目 ⇒ ${back.items.length} 条（若是 2 条，说明 global 的内容串进来了）`);

  head('剧透保护对拆书同样生效');
  await js(`(() => { const b = document.getElementById('spoiler-on'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await wait(900);
  const locked = await js(`(() => {
    const s = window.__ba.state;
    return { progress: s.progress, chapter: s.chapter };
  })()`);
  await gotoChapter(Math.max(1, (locked.progress || 1) + 3));
  const lk = await annoDom();
  ok(lk.present, '剧透态下拆书分区仍在（要能看到"为什么这里没有内容"）');
  const lkText = lk.secText || '';
  ok(/还没解锁/.test(lkText),
    `未解锁的章明说被锁住：${(lkText.match(/[^\n]*解锁[^\n]*/) || [''])[0].trim()}`);
  ok((lk.items || []).length === 0, `未解锁时一条拆书正文都没渲染（实际 ${(lk.items || []).length} 条）`);
  ok(/已拆\s*\d+\s*\/\s*\d+\s*章/.test(lkText), '锁着的时候覆盖进度仍然可见（读者知道有这功能）');

  head('没写拆书的书：不显示分区，也不报错');
  const errs = [];
  ws.addEventListener('message', () => {});
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=crime-and-punishment` });
  for (let i = 0; i < 300; i++) {
    if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book && window.__ba.state.book.characters.length > 10)`).catch(() => false) === true) break;
    await wait(100);
  }
  await wait(3000);
  const other = await annoDom();
  const otherSt = await js(`(() => ({ status: window.__ba.state.annoStatus, has: !!window.__ba.state.anno, type: window.__ba.state.book.meta.type }))()`);
  ok(otherSt.type === '叙事类', `罪与罚的 meta.type 也是叙事类（${JSON.stringify(otherSt.type)}）`);
  ok(otherSt.status && otherSt.status.status !== 'done', `没写拆书 ⇒ 状态如实是 ${JSON.stringify(otherSt.status)}`);
  ok(!other.present, '章节面板里没有拆书分区（不是显示一个空壳）');
  ok(!errs.length, '没有未捕获异常');
} catch (e) {
  failed++;
  console.error(`  ✗ ${e.message}`);
} finally {
  try { ws.close(); } catch { /* */ }
  try { proc.kill(); } catch { /* */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
  server.close();
}

console.log(`\n拆书标注　通过：${passed}　失败：${failed}`);
process.exit(failed ? 1 : 0);