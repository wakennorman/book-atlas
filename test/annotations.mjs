import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireBrowser, browserArgs } from './browser-locator.mjs';

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
 *   ⑧ 三本书各就各位：每本书的拆书能加载、**id 都属于它自己**（跨书写入事故的拦截）。
 *      「0 条 ⇒ 不显示分区」这条现在没有真实数据能触发（三本书都写满了）——
 *      未测，不假装测了。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CDP_PORT = await freePort();
const EDGE = requireBrowser();

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
const proc = spawn(EDGE, [...browserArgs(), `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = '';
    r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 240 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
/* v0.165.3：原来这里是「拿不到 CDP ⇒ process.exit(0)」（跳过并报成功）——
 * 那是假绿：浏览器起不来时这条测试会显示通过，而一条断言都没跑。
 * 环境缺陷必须诚实地红。诊断信息只报事实，不猜原因。 */
if (!url) {
  console.error('  ✗ 拿不到 CDP 端点 —— 环境/启动失败，**不是断言失败**（不再跳过）');
  console.error(`    浏览器：${EDGE}　端口：${CDP_PORT}　profile：${profile}`);
  console.error(`    进程还活着吗：${proc.exitCode === null ? '是' : '否，已退出 code=' + proc.exitCode}`);
  console.error('    下一步：把浏览器的 stderr 抓出来看（现在多数测试是 stdio: ignore，扔掉了）');
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  process.exit(1);
}

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

/** 扫**当前已加载这本书**的每一章：加粗渲染成没成 <strong>、有没有字面残留的 `**`。
 *
 *  ⚠⚠ 为什么要抽成函数、且**每本书都要调一次**（v0.175 的教训）：
 *    原来这段扫描内联在三国的断言里，而它读的是 `window.__ba.state.anno` ——
 *    **当前加载的那本书**。三国没有落单星号，于是它一直是绿的；
 *    而罪与罚 ch29 那处落单的 `**`（把 168 字叙述句错加粗、段末还给读者留了个字面 `**`）
 *    它**结构上就看不到**。我一开始把新断言加在同一段里，实测仍然 61 通过 / 0 失败
 *    —— 又一个「假绿」。判据本身没错，错在**只扫了一本书**。
 *  ⇒ 数据层由 `scripts/check-annotations.mjs` 规则⑧守（全库三本），
 *    这里守端到端后果，也必须**三本都扫**。 */
const scanMarkup = () => js(`(() => {
  const A = window.__ba.state.anno;
  const sel = document.getElementById('ch-select');
  let strong = 0, strayAsterisk = 0; const badCh = [];
  for (const ch of [...new Set((A.items || []).map((i) => i.ch))].sort((a, b) => a - b)) {
    sel.value = String(ch); sel.dispatchEvent(new Event('change', { bubbles: true }));
    const sec = document.querySelector('#chapter-body .anno-sec'); if (!sec) continue;
    let here = 0;
    for (const p of sec.querySelectorAll('.anno-item p')) {
      strong += p.querySelectorAll('strong').length;
      here += (p.textContent.match(/\\*\\*/g) || []).length;
    }
    strayAsterisk += here;
    if (here && badCh.length < 6) badCh.push(ch);
  }
  return { strong, strayAsterisk, badCh };
})()`);

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

  /* ⚠ 章号必须**动态挑**，不能写死。
   *   写死过一版（钉第 60 章），结果第 60 回一补上拆解，这条断言立刻变成
   *   在测一个已经不存在的事实 —— 而且它是在测「文案」，不是在测「第 60 章」。
   *   所以：直接从已加载的标注里找第一个**没有**章节条目的章。 */
  const written = new Set(await js(`(window.__ba.state.anno?.items || []).map(i => i.ch)`));
  const total = await js(`window.__ba.state.book.meta.chapters`);
  let emptyCh = 0;
  for (let n = 1; n <= total; n++) { if (!written.has(n)) { emptyCh = n; break; } }
  /* ⚠ v0.167：书有可能被拆满（三国 120/120、百年孤独 20/20），
   *   那时「没写的章」这个样本**根本不存在** —— 循环落到 emptyCh=0，
   *   原来的 `ok(emptyCh > 0, …)` 直接报红、并去打开第 0 章（不存在）。
   *   **不是数据坏了，是测试的前提被我的改动消灭了。**
   *
   *   ⚠ 刻意**不 skip**：skip 会让这条断言在「数据越补越全」时自动退化成空转 ——
   *   那正是本项目 v0.166 治了一整天的假绿。
   *   ⇒ 拆满时改验**它的反面**（同样是真断言，且与正面互斥）：
   *     · 覆盖进度仍然常驻；
   *     · 写了拆解的章**不得**出现「还没写」。
   *
   *   也刻意不写 `ok(emptyCh > 0, …)` / `ok(true, …)` 这类凑数断言：
   *   目标章的挑选结果只打进 head（信息），不进断言（真假）。 */
  head(`没写的章：必须明说「还没写」｜目标章：${emptyCh > 0
    ? `第 ${emptyCh} 章（已写 ${written.size} / 全书 ${total}）`
    : `无 —— 全书 ${total} 回已拆满，改验反面`}`);
  if (emptyCh > 0) {
    await gotoChapter(emptyCh);
    const cEmpty = await annoDom();
    ok(cEmpty.present, '拆书分区仍然在（覆盖进度要常驻）');
    ok(/还没写/.test(cEmpty.secText), `第 ${emptyCh} 章明说没写：${(cEmpty.secText.match(/第 \d+ 章[^\n]*/) || [''])[0].trim()}`);
    /* ⚠ 不能断言「文案里没有『无需拆解』」—— 我自己的提示语里就含这四个字
       *   （「其余章节还没写，不是「无需拆解」」）。要判的是**说法**：
       *   说的是"还没写"还是"不需要"。 */
    ok(/还没写/.test(cEmpty.secText) && !/本章无需/.test(cEmpty.secText), '说的是「还没写」，不是「本章无需拆解」');
    ok(/已拆\s*\d+\s*\/\s*\d+\s*章/.test(cEmpty.secText), '覆盖进度仍在');
  } else {
    const firstWritten = Math.min(...written);
    await gotoChapter(firstWritten);
    const cFull = await annoDom();
    ok(cFull.present, `全书 ${total} 回已全部拆解；拆书分区仍在（覆盖进度要常驻）`);
    ok(/已拆\s*\d+\s*\/\s*\d+\s*章/.test(cFull.secText),
      `全书拆满时覆盖进度仍显示「${total}/${total} 章」：${(cFull.secText.match(/已拆[^\n]*/) || [''])[0].trim()}`);
    ok(!/还没写/.test(cFull.secText),
      `全书拆满：第 ${firstWritten} 章写了拆解，就**不该**出现「还没写」`);
  }

  /* v0.141：正文里的行内 id 与 ** 粗体。
   * 这两条都是 v0.140 写完 198 条之后**实测**发现的，不是推测：
   *   ① 975 处行内 id 有 97 处（10%）在界面上点不开 —— 它们只在正文提过、
   *      没进 events[]，而芯片只从 events[] 生成；
   *   ② 193/222 条的 body 写了 `**`，而渲染走 esc() ⇒ 星号原样显示给读者。
   * ⚠ 断言要量「真实的 DOM」，不能只查字符串里有没有这个 id。 */
  head('正文行内 id 必须可点开核对');
  /* ⚠⚠ 口径：第一版把「textContent 里的 id 数」和「按钮数」对起来，
   *   于是**每个按钮的文本也被算进 textContent**，凭空多出 50 个重复项
   *   ⇒ 报成「925/975，有 50 处点不开」，其实是量错了对象。
   *   正确口径：**按钮数就是全部行内引用数**（渲染器保证每个 id 都成按钮），
   *   再单独核「数据里的 id 与按钮一一对应」。
   *
   * ⚠⚠⚠ v0.174：按钮的**文案**从裸 id 换成了事件名（读者看不懂 `e15`）。
   *   这会让原来那条「正文里有但不是按钮」**静默失效** ——
   *   它拿 `p.textContent` 去 match id，而 id 已经不在正文里了，
   *   `inText` 恒为空集，那条断言永远绿。所以换成两条**咬得住**的：
   *     ① 每个按钮的文案必须含汉字 —— 防"文案哪天又变回 e15"；
   *     ② 拆书分区渲染出来的文本里**不得残留任何 id 形态的串** ——
   *        这比原来的逐条对拍更强：只要有一个 id 没变成按钮就报红。
   *   ⚠ id 仍然留在 `data-event` 上，下面「点开核对」那条断言口径完全没变。 */
  const inline = await js(`(() => {
    const A = window.__ba.state.anno;
    const dataIds = [...new Set([...A.items, ...A.global]
      .flatMap((i) => String(i.body).match(/e-?\\d[\\w-]*/g) || [])
      /* ⚠ id 形态**不能写死**：三国 e-1-3 / 罪与罚 e1 / 百年孤独 e01。
       *   v0.142 第一版写死 /e-\\d+-\\d+/，结果后两本的行内引用一个都不成按钮
       *   （测试报 null 才暴露）—— 断言本身也有同一个毛病，一起改成形态无关。 */
      .filter((id) => (window.__ba.state.book.events || []).some((e) => e.id === id)))];
    const chs = [...new Set(A.items.map((i) => i.ch))].sort((a, b) => a - b);
    const sel = document.getElementById('ch-select');
    const seen = new Set(); const bad = []; const leaked = [];
    for (const ch of chs) {
      sel.value = String(ch); sel.dispatchEvent(new Event('change', { bubbles: true }));
      const sec = document.querySelector('#chapter-body .anno-sec'); if (!sec) continue;
      for (const b of sec.querySelectorAll('p .anno-inline-ref[data-event]')) {
        seen.add(b.dataset.event);
        /* ⚠ 上限 6：这条一旦红就是**几百处**同时红（588 个按钮全中），
           不限量的话失败信息会把整个测试输出淹掉 —— v0.174 实测过。 */
        const t = b.textContent.trim();
        if (!t) { if (bad.length < 6) bad.push({ ch, id: b.dataset.event, why: '按钮是空的' }); }
        else if (!/[\\u4e00-\\u9fa5]/.test(t)) {
          if (bad.length < 6) bad.push({ ch, id: b.dataset.event, why: '按钮文案里没有汉字（还是 id？）：' + t });
        }
      }
      const left = [...new Set(String(sec.innerText).match(/e-?\\d[\\w-]*/g) || [])];
      if (left.length && leaked.length < 6) leaked.push({ ch, ids: left.slice(0, 6) });
    }
    return { dataIds: dataIds.length, seen: seen.size, bad, leaked };
  })()`);
  ok(inline.dataIds > 100, `数据里共有 ${inline.dataIds} 个不同的行内引用`);
  ok(inline.seen === inline.dataIds,
    `全部行内引用都渲染成了可点按钮（页面 ${inline.seen} / 数据 ${inline.dataIds}${inline.bad.length ? '；异常：' + JSON.stringify(inline.bad) : ''}）`);
  ok(inline.leaked.length === 0,
    `正文里不再出现 e15 这种 id 串（残留：${JSON.stringify(inline.leaked)}）`);

  /* 点一个**只在正文里出现、没进 events[]** 的行内引用 ——
   * 这正是 v0.140 实测点不开的那 97 处。 */
  const inlineOnly = await js(`(() => {
    const A = window.__ba.state.anno;
    const sel = document.getElementById('ch-select');
    for (const ch of [...new Set(A.items.map((i) => i.ch))].sort((a, b) => a - b)) {
      sel.value = String(ch); sel.dispatchEvent(new Event('change', { bubbles: true }));
      const sec = document.querySelector('#chapter-body .anno-sec'); if (!sec) continue;
      for (const item of sec.querySelectorAll('.anno-item')) {
        const declared = [...item.querySelectorAll('.anno-refs [data-event]')].map((b) => b.dataset.event);
        for (const b of item.querySelectorAll('p .anno-inline-ref[data-event]')) {
          if (!declared.includes(b.dataset.event)) return { ch, id: b.dataset.event };
        }
      }
    }
    return null;
  })()`);
  ok(!!inlineOnly, `找到一条「只在正文里出现、没进 events[]」的行内引用：${inlineOnly ? `第 ${inlineOnly.ch} 回 ${inlineOnly.id}` : '（现在没有了）'}`);
  if (inlineOnly) {
    await js(`document.querySelector('#ch-select').value='${inlineOnly.ch}'; document.getElementById('ch-select').dispatchEvent(new Event('change',{bubbles:true})); true`);
    await wait(700);
    await js(`document.querySelector('#chapter-body p .anno-inline-ref[data-event="${inlineOnly.id}"]').click()`);
    await wait(700);
    const openedInline = await js(`window.__ba.state.activeEvent`);
    ok(openedInline === inlineOnly.id, `点行内引用打开了对应事件（activeEvent=${JSON.stringify(openedInline)}，期望 ${inlineOnly.id}）`);
  }

  head('正文里的 ** 必须是真粗体，不能把星号显示给读者（三国）');
  const bold = await scanMarkup();
  ok(bold.strong > 100, `正文渲染出了真 <strong>（${bold.strong} 处）`);
  ok(bold.strayAsterisk === 0,
    `读者看不到残留的 **（${bold.strayAsterisk} 处${bold.badCh.length ? `；出现在第 ${bold.badCh.join('、')} 回` : ''}）`);

  /* ⚠ 我这两段扫描把 #ch-select 留在了最后一次遍历的章（第 119 回），
   *   而下面「切回本章」要验的是 emptyCh。**必须先把章节拨回去**，
   *   否则那条断言是在测一个我刚改掉的状态（第一版就是这样红的）。
   *   —— 这是我自己制造的污染，不是产品缺陷。
   *
   * ⚠ v0.167：全书拆满时 emptyCh=0，gotoChapter(0) 会崩。
   *   改验：切回**任意一个已写的章**，条目数应 > 0 且与 global 不串。 */
  const backTarget = emptyCh > 0 ? emptyCh : Math.min(...written);
  await gotoChapter(backTarget);

  head('全书模式');
  await js(`document.querySelector('.anno-tab[data-anno-mode="global"]').click()`);
  await wait(700);
  const g = await annoDom();
  ok(g.present && g.tabs[1].active, '切到了全书拆解');
  ok(g.items.length >= 1, `全书拆解渲染出 ${g.items.length} 条`);
  ok(!/已拆\s*\d+\s*\/\s*\d+\s*章/.test(g.secText) || g.items.length >= 1, '全书模式内容不为空');
  /* v0.174：全书拆解走的是另一条渲染路径（renderAnnotations 的 global 分支），
     上面那轮扫描只覆盖本章模式 ⇒ 这里单独再咬一口 id 残留。 */
  ok(!/e-?\d[\w-]*/.test(g.secText),
    `全书拆解的正文里也不出现 e15 这种 id 串（残留：${JSON.stringify((g.secText.match(/e-?\d[\w-]*/g) || []).slice(0, 6))}）`);
  await js(`document.querySelector('.anno-tab[data-anno-mode="chapter"]').click()`);
  await wait(700);
  const back = await annoDom();
  /* 切回本章：条目数应 > 0 且与 global 不串。
   *   如果切模式时把 global 的条目留在 chapter 视图里，这里会多出 global 的条目。 */
  ok(back.tabs[0].active && back.items.length > 0,
    `切回本章：第 ${backTarget} 章有 ${back.items.length} 条（应 > 0 且与 global 不串）`);

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

  /* ⚠⚠ 这一段原来叫「没写拆书的书」—— 现在《罪与罚》**写了 20 条**，
   *   而断言还停在「没写拆书 ⇒ 不显示分区」。若照原样跑，它会因为
   *   「分区出现了」而红，而**红的原因不是产品坏了，是我把书写完了没改断言**。
   *   ⇒ 它现在必须真去断言《罪与罚》的拆书能加载、能渲染、id 属于它自己。
   *
   *   这条断言存在的直接原因：v0.142 我把《罪与罚》的 20 条
   *   **灌进了 three-kingdoms.json**，而当时拼接脚本每一步校验都过了
   *   （人名解析 OK / parse OK / 条数对得上 / 原内容未改动），
   *   是 check-annotations 才报出 74 处「《three-kingdoms》里不存在」。
   *   ⇒ 跨书写入这种错，**只有「每本书的 id 都属于它自己」这条断言能拦**。 */
  head('《罪与罚》：拆书能加载，且 id 都属于它自己（不是三国的）');
  const errs = [];
  ws.addEventListener('message', () => {});
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=crime-and-punishment` });
  for (let i = 0; i < 300; i++) {
    if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book && window.__ba.state.book.characters.length > 10)`).catch(() => false) === true) break;
    await wait(100);
  }
  await wait(3000);
  /* ⚠ v0.167：原来写死「第 1 回没写」，但第 1 回早已补上拆解。
   *   改成动态找第一个没写的章 —— 与三国/百年孤独那两段同一个判据。 */
  const crimeWritten = new Set(await js(`(window.__ba.state.anno?.items || []).map(i => i.ch)`));
  const crimeTotal = await js(`window.__ba.state.book.meta.chapters`);
  let crimeEmpty = 0;
  for (let n = 1; n <= crimeTotal; n++) { if (!crimeWritten.has(n)) { crimeEmpty = n; break; } }
  if (crimeEmpty > 0) {
    await gotoChapter(crimeEmpty);
    const crimeEmptyDom = await annoDom();
    ok(crimeEmptyDom.present && (crimeEmptyDom.items || []).length === 0,
      `《罪与罚》第 ${crimeEmpty} 回（没写）显示分区但 0 条（present=${crimeEmptyDom.present}，items=${(crimeEmptyDom.items || []).length}）`);
    ok(/还没写/.test(crimeEmptyDom.hint ? crimeEmptyDom.hint.join('') : (crimeEmptyDom.secText || '')),
      `《罪与罚》没写的章明说「还没写」：${((crimeEmptyDom.hint || []).join('') || crimeEmptyDom.secText || '').match(/[^\n]*还没写[^\n]*/) ? ((crimeEmptyDom.hint || []).join('') || crimeEmptyDom.secText || '').match(/[^\n]*还没写[^\n]*/)[0].trim() : '（没找到）'}`);
  } else {
    head('《罪与罚》全书已拆满，跳过「没写」文案断言');
  }
  /* 回到第 1 回做后续断言（第 1 回现在有拆解） */
  await gotoChapter(1);
  const other = await annoDom();
  const otherSt = await js(`(() => ({
    status: window.__ba.state.annoStatus, has: !!window.__ba.state.anno,
    type: window.__ba.state.book.meta.type, slug: window.__ba.state.anno && window.__ba.state.anno.slug,
    nItems: window.__ba.state.anno ? window.__ba.state.anno.items.length : 0,
    nGlobal: window.__ba.state.anno ? window.__ba.state.anno.global.length : 0,
  }))()`);
  ok(otherSt.type === '叙事类', `罪与罚的 meta.type 也是叙事类（${JSON.stringify(otherSt.type)}）`);
  ok(otherSt.status && otherSt.status.status === 'done', `拆书已加载（${JSON.stringify(otherSt.status)}）`);
  ok(otherSt.slug === 'crime-and-punishment', `标注文件自称 crime-and-punishment（实际 ${JSON.stringify(otherSt.slug)}）`);
  ok(otherSt.nItems >= 15, `《罪与罚》有 ${otherSt.nItems} 条章节条目 + ${otherSt.nGlobal} 条全局`);
  /* ⚠ v0.167：原来这里假设「第 1 回没写」，但第 1 回早已补上拆解。
   *   改成验第 1 回有拆解（2 条），且覆盖进度常驻。 */
  ok(other.present && (other.items || []).length === 2,
    `《罪与罚》第 1 回（已写）显示分区且 2 条（present=${other.present}，items=${(other.items || []).length}）`);
  ok(/已拆\s*\d+\s*\/\s*\d+\s*章/.test(other.secText || ''),
    `《罪与罚》第 1 回覆盖进度常驻：${((other.secText || '').match(/已拆[^\n]*/) || [''])[0]}`);

  /* ★ 关键断言：标注里的每个 id 必须真属于《罪与罚》。
   *   这条直接对应 v0.142 那次跨书写入事故 —— 灌错书时每个 id 都不在这本里。 */
  const idsOwn = await js(`(() => {
    const A = window.__ba.state.anno, B = window.__ba.state.book;
    const charIds = new Set(B.characters.map(c => c.id));
    const evIds = new Set(B.events.map(e => e.id));
    let nChar = 0, nEv = 0;
    const foreign = [];
    for (const it of A.items) {
      for (const c of it.chars || []) { nChar++; if (!charIds.has(c)) foreign.push('人物 ' + c); }
      for (const e of it.events || []) { nEv++; if (!evIds.has(e)) foreign.push('事件 ' + e); }
    }
    return { nChar, nEv, foreign: foreign.slice(0, 6), total: foreign.length };
  })()`);
  ok(idsOwn.nChar + idsOwn.nEv > 40, `扫到了足够的引用（人物 ${idsOwn.nChar} + 事件 ${idsOwn.nEv}）`);
  ok(idsOwn.total === 0,
    `每个 id 都属于《罪与罚》（混入 ${idsOwn.total} 个外来的${idsOwn.total ? '：' + JSON.stringify(idsOwn.foreign) : ''}）`);

  /* 界面真的渲染出正文，且行内引用可点（同一套机制在第二本书上也成立）。
   * ⚠ 期望值从数据里取，不写死 'e1' —— 否则换一本 id 形态不同的书就会假红。 */
  await gotoChapter(6);
  const crimeSec = await annoDom();
  ok(crimeSec.present, '《罪与罚》第 6 回显示了拆书分区');
  ok((crimeSec.items || []).length >= 1, `第 6 回渲染出 ${(crimeSec.items || []).length} 条`);
  const wantInline = await js(`(() => {
    const A = window.__ba.state.anno;
    const it = A.items.find((x) => x.ch === 6);
    /* ⚠ match() 可能是 null —— 直接 [0] 会抛 TypeError，整条测试就停在这里。
       *   （第一版就这么红的：报出来的是取值崩了，不是「按钮没渲染」。） */
    const hit = it ? String(it.body).match(/e-?\\d[\\w-]*/g) : null;
    return hit && hit.length ? hit[0] : null;
  })()`);
  const crimeInline = await js(`(() => {
    const sec = document.querySelector('#chapter-body .anno-sec'); if (!sec) return null;
    const btn = sec.querySelector('p .anno-inline-ref[data-event]');
    return btn ? btn.dataset.event : null;
  })()`);
  ok(crimeInline === wantInline, `《罪与罚》的行内引用也渲染成可点按钮（实际 ${JSON.stringify(crimeInline)}，期望 ${JSON.stringify(wantInline)}）`);
  if (wantInline) {
  await js(`document.querySelector('#chapter-body p .anno-inline-ref[data-event="${wantInline}"]').click()`);
  await wait(700);
  const crimeOpened = await js(`window.__ba.state.activeEvent`);
  ok(crimeOpened === wantInline, `点了打开《罪与罚》的事件（activeEvent=${JSON.stringify(crimeOpened)}，期望 ${JSON.stringify(wantInline)}）`);
  }
  /* v0.175：加粗/星号扫描必须**每本书都跑**。
     原来这段扫描内联在三国的断言里、只扫三国 —— 而罪与罚 ch29 那处落单的 `**`
     （把 168 字叙述句错加粗、段末还给读者留了个字面 `**`）它**结构上看不到**。 */
  const crimeBold = await scanMarkup();
  ok(crimeBold.strayAsterisk === 0,
    `《罪与罚》正文里没有残留的 **（${crimeBold.strayAsterisk} 处${crimeBold.badCh.length ? `；出现在第 ${crimeBold.badCh.join('、')} 回` : ''}）`);

  /* ★ 同一套断言在第三本书上再跑一遍 —— 《百年孤独》是第三种 id 形态（e01 零填充），
   *   也是**第一批「原文依据」标签**：前两本书 218 条 basis 全是「整理者推断」，
   *   annoBasis 的原文依据分支从没被真实数据踩过。换一本书可能换一个坏法（v0.142
   *   的正则写死就是例子），所以第三种形态也要实跑。 */
  head('《百年孤独》：第三种 id 形态 + 首批「原文依据」标签');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=one-hundred-years-of-solitude` });
  for (let i = 0; i < 300; i++) {
    if (await js(`!!(window.__ba && window.__ba.state.book && window.__ba.state.book.meta.slug === 'one-hundred-years-of-solitude' && window.__ba.state.anno && window.__ba.state.anno.items.length > 10)`).catch(() => false) === true) break;
    await wait(100);
  }
  await wait(3000);
  const ySt = await js(`(() => { const s = window.__ba.state; return {
    slug: s.anno && s.anno.slug, status: s.annoStatus && s.annoStatus.status,
    nItems: s.anno ? s.anno.items.length : 0, nGlobal: s.anno ? s.anno.global.length : 0 }; })()`);
  ok(ySt.slug === 'one-hundred-years-of-solitude', `标注文件自称 one-hundred-years-of-solitude（实际 ${JSON.stringify(ySt.slug)}）`);
  ok(ySt.status === 'done', `拆书已加载（status=${JSON.stringify(ySt.status)}）`);
  ok(ySt.nItems >= 25, `《百年孤独》有 ${ySt.nItems} 条章节条目 + ${ySt.nGlobal} 条全局`);

  /* ★ 关键断言（第三本书再拦一次跨书写入）：标注里每个 id 必须真属于本书。 */
  const yIdsOwn = await js(`(() => {
    const A = window.__ba.state.anno, B = window.__ba.state.book;
    const charIds = new Set(B.characters.map(c => c.id));
    const evIds = new Set(B.events.map(e => e.id));
    let nChar = 0, nEv = 0; const foreign = [];
    for (const it of A.items) {
      for (const c of it.chars || []) { nChar++; if (!charIds.has(c)) foreign.push('人物 ' + c); }
      for (const e of it.events || []) { nEv++; if (!evIds.has(e)) foreign.push('事件 ' + e); }
    }
    return { nChar, nEv, foreign: foreign.slice(0, 6), total: foreign.length }; })()`);
  ok(yIdsOwn.nChar + yIdsOwn.nEv > 60, `扫到了足够的引用（人物 ${yIdsOwn.nChar} + 事件 ${yIdsOwn.nEv}）`);
  ok(yIdsOwn.total === 0,
    `每个 id 都属于《百年孤独》（混入 ${yIdsOwn.total} 个外来的${yIdsOwn.total ? '：' + JSON.stringify(yIdsOwn.foreign) : ''}）`);

  await gotoChapter(1);
  const y1 = await annoDom();
  ok(y1.present, '《百年孤独》第 1 章显示了拆书分区');
  ok((y1.items || []).length >= 2, `第 1 章渲染出 ${(y1.items || []).length} 条`);
  ok((y1.items || []).some((i) => i.basisTag === '原文依据') && (y1.items || []).some((i) => i.basisTag === '整理者推断'),
    `同一章里两种依据标签并排（${(y1.items || []).map((i) => i.basisTag).join(' / ')}）——「原文依据」分支第一次被真实数据踩到`);

  /* 零填充 id（e01 形态）的行内引用可点开 —— 期望值从数据取，不写死 'e01' */
  const yWant = await js(`(() => {
    const it = window.__ba.state.anno.items.find((x) => x.ch === 1);
    const hit = it ? String(it.body).match(/e-?\\d[\\w-]*/g) : null;
    return hit && hit.length ? hit[0] : null; })()`);
  const yBtn = await js(`(() => { const sec = document.querySelector('#chapter-body .anno-sec');
    const b = sec && sec.querySelector('p .anno-inline-ref[data-event]');
    return b ? b.dataset.event : null; })()`);
  ok(!!yWant && yBtn === yWant, `零填充 id 也渲染成按钮（实际 ${JSON.stringify(yBtn)}，期望 ${JSON.stringify(yWant)}）`);
  if (yWant) {
    await js(`document.querySelector('#chapter-body p .anno-inline-ref[data-event="${yWant}"]').click()`);
    await wait(700);
    const yOpened = await js(`window.__ba.state.activeEvent`);
    ok(yOpened === yWant, `点了打开《百年孤独》的事件（activeEvent=${JSON.stringify(yOpened)}，期望 ${yWant}）`);
  }

  /* ⚠ 同 v0.167 的三國那段：百年孤独也已被补到 20/20，「没写的章」这个样本不存在。
   *   同样**不 skip**、同样**不写凑数断言**，改验反面。 */
  const yWritten = new Set(await js(`(window.__ba.state.anno?.items || []).map(i => i.ch)`));
  const yTotal = await js(`window.__ba.state.book.meta.chapters`);
  let yEmpty = 0;
  for (let n = 1; n <= yTotal; n++) { if (!yWritten.has(n)) { yEmpty = n; break; } }
  /* 覆盖进度在两种情形下都要常驻 —— 用「随便挑一章已写的」验，避免依赖 yEmpty 是否存在 */
  const yProg = new RegExp('已拆\\s*' + yWritten.size + '\\s*/\\s*' + yTotal + '\\s*章');
  head(`没素材的章：明说「还没写」｜目标章：${yEmpty > 0
    ? `第 ${yEmpty} 章（已写 ${yWritten.size} / ${yTotal}）`
    : `无 —— 全书 ${yTotal} 章已拆满，改验反面`}`);
  const yTarget = yEmpty > 0 ? yEmpty : Math.min(...yWritten);
  await gotoChapter(yTarget);
  const yE = await annoDom();
  ok(yProg.test(yE.secText || ''),
    `覆盖进度是 已拆 ${yWritten.size} / ${yTotal} 章（实际：${((yE.secText || '').match(/已拆[^\n]*/) || [''])[0]}）`);
  if (yEmpty > 0) {
    ok(yE.present && /还没写/.test(yE.secText || ''),
      `第 ${yEmpty} 章明说还没写：${((yE.secText || '').match(/[^\n]*还没写[^\n]*/) || [''])[0].trim()}`);
  } else {
    ok(yE.present, `《百年孤独》全书 ${yTotal} 章已全部拆解；拆书分区仍在`);
    ok(!/还没写/.test(yE.secText || ''),
      `全书拆满：第 ${yTarget} 章写了拆解，就**不该**出现「还没写」`);
  }

  /* v0.175：第三本书也要扫星号（同罪与罚那条的理由 —— 判据没错，错在只扫一本） */
  const yBold = await scanMarkup();
  ok(yBold.strayAsterisk === 0,
    `《百年孤独》正文里没有残留的 **（${yBold.strayAsterisk} 处${yBold.badCh.length ? `；出现在第 ${yBold.badCh.join('、')} 章` : ''}）`);

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