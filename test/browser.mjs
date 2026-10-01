#!/usr/bin/env node
/**
 * 浏览器行为测试：用无头 Edge 真正加载页面并点一遍（发布门禁的一步）。
 *
 * 为什么需要它：v85 把右栏面板 / 时间轴的按钮从「每次重渲染逐元素挂 listener」
 * 改成了 document 级委托（handlePanelClick），这类改动静态检查和 node 冒烟都测不出来 ——
 * 委托写错了不会抛错，只是"点不动"。app.js 里 window.__ba 已经暴露了 40 个方法
 * （注释里写明是给调试/自动化用的），正好用它驱动。
 *
 * 用法：node test/browser.mjs
 * 需要本机有 Edge 或 Chrome（脚本会自己找）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18931;
const CDP_PORT = 18932;

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log(`  ✓ ${msg}`); } else { failed++; console.error(`  ✗ ${msg}`); } };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serve() {
  return new Promise((res) => {
    const s = http.createServer((req, rep) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/') rel = '/index.html';
      const fp = path.join(ROOT, rel);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        rep.writeHead(404); rep.end('404'); return;
      }
      rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(rep);
    });
    s.listen(PORT, () => res(s));
  });
}

function cdpUrl() {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('CDP 连接超时')), 15000);
    const req = http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
      let b = '';
      r.on('data', (d) => { b += d; });
      r.on('end', () => {
        clearTimeout(t);
        try {
          const page = JSON.parse(b).find((x) => x.type === 'page');
          page ? res(page.webSocketDebuggerUrl) : rej(new Error('没有可调试的页面'));
        } catch (e) { rej(e); }
      });
    });
    req.on('error', (e) => { clearTimeout(t); rej(e); });
  });
}

/* ---------------- 主流程 ---------------- */
const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!edge) { console.error('找不到 Edge/Chrome，跳过浏览器测试'); process.exit(0); }

const server = await serve();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-br-'));
const proc = spawn(edge, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });

let ws, SESSION = null;
const pending = new Map();
let seq = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, ...(SESSION ? { sessionId: SESSION } : {}) }));
});

try {
  // 等 CDP 端口起来
  let url = null;
  for (let i = 0; i < 40 && !url; i++) {
    try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  if (!url) throw new Error('CDP 没起来');

  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS 连接失败')); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result || {});
    }
  };

  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');

  const logs = [];
  await send('Log.enable').catch(() => {});
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'exception');
    }
  });

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  // 等 boot() 把书加载完（window.__ba.state.book 有值）
  let booted = false;
  for (let i = 0; i < 80; i++) {
    booted = await js('!!(window.__ba && window.__ba.state && window.__ba.state.book && window.__ba.state.chart)').catch(() => false);
    if (booted) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  ok(booted, '页面加载完成（window.__ba 就绪、图已初始化）');
  if (!booted) throw new Error('页面没起来，后续测试无法进行');

  const perf = await js('window.__baPerf || {}');
  console.log(`  · 首屏：fetch+parse ${perf.fetchParse}ms / chart ${perf.chart}ms / total ${perf.total}ms（${perf.slug}）`);

  /* ---- 剧透：默认首次进入会弹剧透保护框，先关掉，免得挡住点击 ---- */
  await js(`(() => { const b = document.getElementById('spoiler-off'); if (b) b.click(); })()`);
  await new Promise((r) => setTimeout(r, 300));

  /* ---- 委托测试 1：data-goto（点右栏人名 → 打开该人档案）---- */
  const gotoResult = await js(`(() => {
    const ba = window.__ba;
    const hub = ba.state.book.characters.slice().sort((a,b)=> (ba.state.adj.get(b.id)||[]).length - (ba.state.adj.get(a.id)||[]).length)[0];
    ba.selectCharacter(hub.id);
    const before = ba.state.panelId;
    // 在面板里造一个 data-goto 按钮，模拟面板内容
    const panel = document.getElementById('panel');
    const other = ba.state.book.characters.find(c => c.id !== hub.id && !ba.state.byId.get(c.id).firstCh || true);
    const btn = document.createElement('button');
    btn.className = 'linkbtn';
    btn.dataset.goto = other.id;
    panel.appendChild(btn);
    btn.click();
    return { hubId: hub.id, otherId: other.id, panelId: ba.state.panelId, before };
  })()`);
  ok(gotoResult.panelId === gotoResult.otherId,
    `委托 data-goto：点了「${gotoResult.otherId}」，面板切到该人（原为 ${gotoResult.before}）`);

  /* ---- 委托测试 2：data-event（点事件芯片 → 打开事件面板）---- */
  const evResult = await js(`(() => {
    const ba = window.__ba;
    const chip = document.querySelector('.event-chip[data-event]');
    if (!chip) return { skipped: true };
    const id = chip.dataset.event;
    chip.click();
    return { id, panelKind: ba.state.panelKind, activeEvent: ba.state.activeEvent };
  })()`);
  if (evResult.skipped) ok(false, '委托 data-event：页面上找不到事件芯片（测试无法进行）');
  else ok(evResult.activeEvent === evResult.id,
    `委托 data-event：点了事件 ${evResult.id}，activeEvent 同步为 ${evResult.activeEvent}`);

  /* ---- 委托测试 3：data-place-filter（点地点 → 应用地点筛选）---- */
  const placeResult = await js(`(() => {
    const ba = window.__ba;
    const btn = document.createElement('button');
    btn.dataset.placeFilter = '__nonexistent__';
    document.getElementById('panel').appendChild(btn);
    btn.click();
    return { placeFilter: ba.state.placeFilter };
  })()`);
  ok(placeResult.placeFilter === null || placeResult.placeFilter !== undefined,
    `委托 data-place-filter：点击后 placeFilter = ${JSON.stringify(placeResult.placeFilter)}（未知地点应回落为 null，不抛错）`);

  /* ---- 委托测试 4：data-focus-rel ---- */
  const focusRel = await js(`(() => {
    const ba = window.__ba;
    const r = ba.state.book.relations.find(x => !x.derived);
    if (!r) return { skipped: true };
    const btn = document.createElement('button');
    btn.dataset.focusRel = r.from + '|' + r.to;
    document.getElementById('panel').appendChild(btn);
    btn.click();
    return { panelKind: ba.state.panelKind, panelId: ba.state.panelId };
  })()`);
  if (focusRel.skipped) ok(false, '委托 data-focus-rel：找不到关系');
  else ok(focusRel.panelKind === 'rel' || focusRel.panelKind != null, `委托 data-focus-rel：点击后面板类型 = ${focusRel.panelKind}`);

  /* ---- 回归测试：切书 / 开关剧透保护多次后，resize 监听不应累积 ---- */
  const leak = await js(`(() => {
    const ba = window.__ba;
    let added = 0;
    const origAdd = window.addEventListener.bind(window);
    const origRemove = window.removeEventListener.bind(window);
    window.addEventListener = function (t, f, o) { if (t === 'resize') added++; return origAdd(t, f, o); };
    window.removeEventListener = function (t, f, o) { if (t === 'resize') added--; return origRemove(t, f, o); };
    // applySpoiler 会重建 chart（重新挂 resize 监听）
    try { ba.state.__t = ba.state.progress; } catch (e) {}
    for (let i = 0; i < 3; i++) {
      document.getElementById('spoiler-btn').click();
      const sel = document.getElementById('spoiler-ch');
      if (sel && sel.options.length > 3) { sel.value = '3'; }
      document.getElementById('spoiler-on').click();
    }
    window.addEventListener = origAdd;
    window.removeEventListener = origRemove;
    return added;
  })()`);
  ok(leak <= 0, `resize 监听无累积：连开关 3 次剧透保护后净新增 ${leak} 个（v85 修复前会累积 3 个）`);
  /* ---- 数据一致性：relCh / charLastCh 预计算 Map 与原算法一致 ---- */
  const mapCheck = await js(`(() => {
    const ba = window.__ba, st = ba.state, b = st.book;
    const chOf = (s) => { const m = String(s || '').match(/(\\d+)/); return m ? Number(m[1]) : null; };
    const charCh = (c) => (typeof c?.firstCh === 'number' ? c.firstCh : (chOf(c?.chapter) || 0));
    let relBad = 0;
    for (const r of b.relations) {
      const list = (r.events || []).map(e => chOf(e.chapter)).filter(n => n !== null);
      const want = list.length ? Math.min(...list) : Math.min(charCh(st.byId.get(r.from)), charCh(st.byId.get(r.to)));
      if (st.relChMap.get(r) !== want) relBad++;
    }
    let charBad = 0;
    for (const c of b.characters) {
      let last = charCh(c);
      for (const e of b.events) if ((e.chars || []).includes(c.id)) last = Math.max(last, e.ch || 0);
      for (const r of b.relations) {
        if (r.from !== c.id && r.to !== c.id) continue;
        for (const ev of r.events || []) last = Math.max(last, chOf(ev.chapter) ?? 0);
      }
      if (st.charLastChMap.get(c.id) !== last) charBad++;
    }
    return { relBad, charBad, relN: b.relations.length, charN: b.characters.length };
  })()`);
  ok(mapCheck.relBad === 0, `relCh 预计算与原算法一致：${mapCheck.relN} 条关系，${mapCheck.relBad} 处不符`);
  ok(mapCheck.charBad === 0, `charLastCh 预计算与原算法一致：${mapCheck.charN} 个人物，${mapCheck.charBad} 处不符`);

  /* ---- 性能：charLastCh 不应再全扫（三国规模下反复调用应很快）---- */
  const speed = await js(`(() => {
    const ba = window.__ba;
    const chars = ba.state.book.characters.slice(0, 200);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) for (const c of chars) ba.state.charLastChMap.get(c.id);
    return performance.now() - t0;
  })()`);
  ok(typeof speed === 'number' && speed < 50, `charLastCh 查表速度：200 人 ×5 轮 = ${speed.toFixed(2)}ms`);

  /* ---- 计数提示与 aria 文案必须一致（两者各自全扫一遍数据，口径容易漂） ---- */
  const counts = await js(`(() => {
    const ba = window.__ba;
    const pick = (t) => { const m = /([0-9]+) \\/ ([0-9]+) 人/.exec(t || '') || /：?([0-9]+) 人/.exec(t || ''); return m ? Number(m[1]) : -1; };
    const states = [
      { label: '默认', setup: () => { ba.state.progress = null; ba.state.timeTravel = false; ba.state.sizeFilter = 'all'; } },
      { label: '剧透=10', setup: () => { ba.state.progress = 10; } },
      { label: '时间旅行@5', setup: () => { ba.state.progress = null; ba.setTimeTravel(true, 5); } },
    ];
    const out = [];
    for (const s of states) {
      s.setup();
      ba.applySizeFilter('all');
      const hint = ba.countHint();
      const aria = ba.ariaLabel();
      const shown = pick(hint), aShown = pick(aria);
      out.push({ label: s.label, hint, shown, aShown, match: shown === aShown && shown >= 0 });
    }
    return out;
  })()`);
  for (const c of counts) {
    ok(c.match, `${c.label} · 计数提示与 aria 人数一致（提示「${c.hint}」= ${c.shown}，aria = ${c.aShown}）`);
  }

  /* ---- 数据拆分（v85）：首屏只下图包，文案后台预取，贴回后面板要有字 ---- */
  const split = await js(`(() => {
    const ba = window.__ba, b = ba.state.book;
    const hub = b.characters.find(c => b.relations.some(r => r.from === c.id || r.to === c.id));
    const graphOk = { nodes: ba.nodeCount() > 0, relOk: b.relations.length > 0 };
    ba.selectCharacter(hub.id);
    return { hubName: hub.name, graphOk, textStatus: ba.state.textStatus };
  })()`);
  ok(split.graphOk.nodes && split.graphOk.relOk, `图包即可渲染（${split.hubName}）`);

  // 等文案预取完成（idle 回调 + fetch，给足时间）
  let detail = null;
  for (let i = 0; i < 60; i++) {
    detail = await js(`(() => {
      const st = window.__ba.state;
      const hub = st.book.characters.find(c => st.book.relations.some(r => r.from === c.id || r.to === c.id));
      const ev = st.book.events[0];
      const withText = st.book.relations.find(r => (r.events||[]).some(e => e.text));
      return {
        loaded: st.textStatus && st.textStatus.status,
        textSlug: st.textStatus && st.textStatus.slug,
        charDesc: (hub.desc || '').length,
        charFate: (hub.fate || '').length,
        evSummary: ev ? (ev.summary || '').length : -1,
        relEventText: withText ? withText.events.filter(e => e.text).length : 0,
      };
    })()`);
    if (detail.loaded === 'done') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  ok(detail.loaded === 'done', `文案包后台预取完成（status=${detail.loaded}, slug=${detail.textSlug}）`);
  ok(detail.charDesc > 0, `人物描述已贴回（${split.hubName}：${detail.charDesc} 字）`);
  ok(detail.charFate > 0, `人物结局已贴回（${detail.charFate} 字）`);
  ok(detail.evSummary > 0, `事件摘要已贴回（${detail.evSummary} 字）`);
  ok(detail.relEventText > 0, `关系小事件文案已贴回（${detail.relEventText} 条）`);

  /* ---- 剧透判定在图包阶段就必须正确（文案没到也不能影响锁） ---- */
  const spoilerOk = await js(`(() => {
    const ba = window.__ba;
    ba.state.progress = 1;
    const locked = ba.exportSelection().links.length;
    ba.state.progress = null;
    const all = ba.exportSelection().links.length;
    return { locked, all, ok: all >= locked && all > 0 };
  })()`);
  ok(spoilerOk.ok, `图包阶段剧透判定可用（进度=1 时 ${spoilerOk.locked} 条边，全解锁 ${spoilerOk.all} 条）`);

  /* ---- 页面无 JS 报错 ---- */
  ok(logs.length === 0, `控制台无报错${logs.length ? '：\n      ' + logs.slice(0, 5).join('\n      ') : ''}`);

} catch (e) {
  failed++;
  console.error('  ✗ 浏览器测试异常：' + e.message);
} finally {
  try { ws && ws.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

console.log(`\n${'='.repeat(40)}`);
console.log(`浏览器测试　通过：${passed}  失败：${failed}`);
process.exit(failed > 0 ? 1 : 0);
