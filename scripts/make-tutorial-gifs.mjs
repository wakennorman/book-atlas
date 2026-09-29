#!/usr/bin/env node
/**
 * 动图教程生成器：用无头 Edge（CDP）真实点击页面，逐帧截图，供 assemble-gif.py 合成 GIF。
 *
 * 为什么要真实点击：教程要展示的就是真实交互（悬停出提示、点事件图上聚焦、拖滑块时间旅行），
 * 靠静态图拼不出来；截图不用用户屏幕，任何时候都能跑。
 *
 * 用法：
 *   node scripts/make-tutorial-gifs.mjs                 # 生成全部场景
 *   node scripts/make-tutorial-gifs.mjs search time-travel
 *   node scripts/make-tutorial-gifs.mjs --width 1024 --height 640 --fps 10
 *
 * 场景（见下面 SCENES）：
 *   search       搜「诸葛亮」→ 回车 → 面板打开、图上居中聚焦
 *   event-focus  点事件轴「桃园三结义」→ 图上高亮 + 自动放大聚焦
 *   time-travel  打开时间旅行 → 拖滑块到第 60 章 → 图按章过滤
 *
 * 产物：docs/tutorial/frames/<scene>/NNN.png（帧）→ docs/tutorial/<scene>.gif（由 python 合成）
 * 依赖：系统 Edge；本地服务（没起会自动 python -m http.server 8765）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/bin/google-chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const PORT = 9401;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- CLI ---------------- */
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const WIDTH = Number(flag('--width', 1280));
const HEIGHT = Number(flag('--height', 800));
const BASE = flag('--base', 'http://localhost:8765');
const OUT = path.resolve(flag('--out', path.join(ROOT, 'docs', 'tutorial')));
const sceneArgs = args.filter((a) => !a.startsWith('--'));

/* ---------------- 场景定义 ----------------
 * step 类型：
 *   wait   ms          停顿（继续截帧）
 *   move   to          光标移动到目标（DOM 位置，真实 mouseMoved 悬停）
 *   click  to          点击（真实 mousePressed/Released）
 *   type   text        逐字输入（真实 insertText）
 *   key    name        按键（真实 dispatchKeyEvent）
 *   hold   n           原地停留 n 帧（看结果）
 */
const SCENES = {
  search: {
    url: '?book=three-kingdoms',
    steps: [
      { wait: 400, hold: 3 },
      { move: '#search-input' },
      { click: '#search-input', hold: 3 },
      { type: '诸葛亮', hold: 3 },
      { key: 'Enter' },
      { wait: 500, hold: 4 },
      { hold: 14 },                     // 看：面板打开 + 图聚焦到诸葛亮
    ],
  },
  'event-focus': {
    url: '?book=three-kingdoms',
    // 右侧比屏幕高：先把「本章事件」滚进画面（图仍在画面里），点它，再滚回顶部看聚焦结果
    steps: [
      { wait: 400, hold: 3 },
      { scrollWin: { to: '#chapter-body button[data-event]', y: 560 } },
      { move: '#chapter-body button[data-event]', hold: 3 },
      { click: '#chapter-body button[data-event]', hold: 5 },
      { scrollWin: { to: 0 } },
      { hold: 18 },                     // 看：三兄弟高亮、其余变淡、视野已放大过去
    ],
  },
  'time-travel': {
    url: '?book=three-kingdoms',
    steps: [
      { wait: 400, hold: 3 },
      { move: '#time-btn', hold: 2 },
      { click: '#time-btn', hold: 4 },  // 打开滑块
      { drag: { from: '#time-slider', to: 0.55 }, hold: 6 },  // 拖到约第 60 章
      { hold: 14 },                     // 看：只画第 60 章之前已发生的关系
    ],
  },
};
const scenes = (sceneArgs.length ? sceneArgs : Object.keys(SCENES));
for (const s of scenes) if (!SCENES[s]) { console.error(`未知场景「${s}」，可选：${Object.keys(SCENES).join(' / ')}`); process.exit(1); }

/* ---------------- 本地服务 ---------------- */
// 注意：python -m http.server 是 HTTP/1.0 且不支持 keep-alive，Node 内置 fetch（undici）
// 连它会触发 undici 的 assert(!this.paused) 崩溃——所以健康检查用 node:http 手写。
function httpGet(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers: { Connection: 'close' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ ok: false, status: 0, body: '' }));
    req.setTimeout(4000, () => { req.destroy(); resolve({ ok: false, status: 0, body: '' }); });
  });
}
async function ensureServer() {
  if ((await httpGet(BASE + '/index.html')).ok) return null;
  console.log('· 本地服务没起，自动启动 python -m http.server 8765');
  const p = spawn('python', ['-m', 'http.server', '8765'], { cwd: ROOT, stdio: 'ignore', detached: true });
  p.unref();
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    if ((await httpGet(BASE + '/index.html')).ok) return p;
  }
  throw new Error('本地服务启动失败（可手动 python -m http.server 8765）');
}

/* ---------------- CDP ---------------- */
let ws, seq = 0, SESSION = null;
const pending = new Map();

async function cdpConnect() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await httpGet(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) {
        const list = JSON.parse(r.body);
        const page = list.find((t) => t.type === 'page');
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject: (e) => reject(new Error(e.message + (method.startsWith('Input.') ? ' | params=' + JSON.stringify(params) : ''))) });
    ws.send(JSON.stringify({ id, method, params, ...(SESSION ? { sessionId: SESSION } : {}) }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error('超时：' + method)); }, 20000);
  });
}
async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
  return r.result.value;
}

/* ---------------- 截帧 / 光标 ---------------- */
let frameDir, frameNo = 0;
async function shot() {
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  frameNo++;
  fs.writeFileSync(path.join(frameDir, String(frameNo).padStart(3, '0') + '.png'), Buffer.from(s.data, 'base64'));
}
let cursor = [WIDTH * 0.5, HEIGHT * 0.55];
async function cursorTo(x, y, down = false) {
  cursor = [x, y];
  await js(`window.__tutCursor(${x}, ${y}, ${down})`);
}
/** 光标沿直线移动（分 steps 段，每段都发真实 mouseMoved 并截一帧） */
async function moveTo(target, steps = 7) {
  const [x, y] = await resolve(target);
  const [x0, y0] = cursor;
  for (let i = 1; i <= steps; i++) {
    const px = x0 + (x - x0) * (i / steps);
    const py = y0 + (y - y0) * (i / steps);
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error(`moveTo 坐标无效（${px},${py}），目标：${JSON.stringify(target)}`);
    await cursorTo(px, py);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'none', buttons: 0 });
    await sleep(35);
    await shot();
  }
}
async function resolve(sel) {
  if (Array.isArray(sel)) return [sel[0], sel[1]];
  if (typeof sel === 'object' && sel) return [sel.x, sel.y];
  const rect = await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;
      return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  if (!rect) throw new Error('找不到元素：' + sel);
  return rect;
}
async function mouseClick(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`点击坐标无效（${x},${y}）`);
  await cursorTo(x, y, true);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await shot();                                     // 按下瞬间
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await cursorTo(x, y, false);
  await sleep(80);
}
async function dragRange(sel, frac) {
  // 拖 <input type=range> 到某一比例（真实按下→移动→松开）
  const geo = await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
      const r = el.getBoundingClientRect();
      const min = +el.min || 0, max = +el.max || 100, v = +el.value;
      const f = (v - min) / (max - min || 1);
      return { l: r.left, w: r.width, y: r.top + r.height / 2, f }; })()`);
  if (!geo) throw new Error('找不到滑块：' + sel);
  if (![geo.l, geo.w, geo.y, geo.f].every(Number.isFinite)) throw new Error('滑块几何无效：' + JSON.stringify(geo));
  const x0 = geo.l + Math.max(6, geo.f * geo.w), x1 = geo.l + Math.max(6, frac * geo.w);
  const y = geo.y;
  await moveTo([x0, y], 5);
  await cursorTo(x0, y, true);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  const N = 10;
  for (let i = 1; i <= N; i++) {
    const px = x0 + (x1 - x0) * (i / N);
    await cursorTo(px, y, true);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y, button: 'left', buttons: 1 });
    await sleep(60);
    await shot();
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y, button: 'left', buttons: 0, clickCount: 1 });
  await cursorTo(x1, y, false);
}

/* ---------------- 场景执行 ---------------- */
const CURSOR_HTML = `
(() => {
  if (window.__tutCursor) return;
  const el = document.createElement('div');
  el.id = 'tut-cursor';
  el.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate3d(-100px,-100px,0);will-change:transform';
  el.innerHTML = '<svg width="26" height="32" viewBox="0 0 26 32" style="overflow:visible"><path d="M3 2 L3 23 L9 17.5 L12.6 27 L17 25.2 L13.4 16 L21 15 Z" fill="#1d2a53" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/></svg>'
    + '<div class="ring" style="position:absolute;left:-7px;top:-8px;width:24px;height:24px;box-sizing:border-box;border:3.5px solid #c99a3f;border-radius:50%;transition:transform .12s ease,opacity .12s ease"></div>';
  document.body.appendChild(el);
  window.__tutCursor = (x, y, down) => {
    el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    const ring = el.querySelector('.ring');
    ring.style.transform = down ? 'scale(.62)' : 'scale(1)';
    ring.style.opacity = down ? '.9' : '1';
  };
})()`;

async function runScene(name, def) {
  frameDir = path.join(OUT, 'frames', name);
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });
  frameNo = 0;

  await send('Page.navigate', { url: BASE + '/' + def.url });
  await js(`new Promise(r => { const done = () => r(1); if (document.readyState === 'complete') done();
      else addEventListener('load', done); setTimeout(done, 9000); })`);
  await js(`new Promise(r => setTimeout(r, 400))`);
  // 等图真的渲染出来（弹窗和首屏渲染都有延迟，早了会截到空画布）
  await js(`(async () => { for (let i = 0; i < 60; i++) {
      if (window.__ba && __ba.state && __ba.state.pos && __ba.state.pos.size > 0
          && document.querySelector('#graph canvas')) return 1;
      await new Promise(r => setTimeout(r, 200)); } return 0; })()`);
  // 首次访问的「选路线」弹窗：它可能延迟出现，所以要「见过它、且已关掉」才算完
  const modalState = await js(`(async () => { let seen = false;
      for (let i = 0; i < 30; i++) {
        const m = document.getElementById('spoiler-modal');
        const open = m && !m.hidden;
        if (open) { seen = true; const b = document.getElementById('spoiler-off'); if (b) b.click(); }
        else if (seen) return 'dismissed';
        await new Promise(r => setTimeout(r, 150)); }
      return seen ? 'still-open' : 'never-shown'; })()`);
  if (modalState === 'still-open') throw new Error('剧透路线弹窗关不掉，停止录制');
  console.log('  · 弹窗处理：' + modalState + ' | ' + JSON.stringify(await js(`(window.__modalLog || []).map(a => a[0] + 'ms ' + (a[1] ? '关' : '开'))`)));
  await js(`window.scrollTo(0, 0)`);
  await js(`new Promise(r => setTimeout(r, 600))`);
  await js(CURSOR_HTML);
  await js(`window.__tutCursor(${WIDTH * 0.5}, ${HEIGHT * 0.55}, false)`);
  cursor = [WIDTH * 0.5, HEIGHT * 0.55];
  if (await js(`!!(document.getElementById('spoiler-modal') && !document.getElementById('spoiler-modal').hidden)`)) {
    throw new Error('剧透路线弹窗仍在，停止录制（避免录出废片）');
  }

  console.log(`\n▶ 场景 ${name}（${def.url}）`);  for (const step of def.steps) {
    try {
    if (step.wait) { await sleep(step.wait); }
    if (step.hold) { for (let i = 0; i < step.hold; i++) { await sleep(180); await shot(); } }
    if (step.move) { await moveTo(step.move); }
    if (step.scrollWin) {
      // 整页滚动（右侧比屏幕高）：动画滚过去并逐帧截，像真人用滚轮
      const spec = step.scrollWin;
      let target = typeof spec.to === 'number' ? spec.to : null;
      if (target === null) {
        let top = null;
        for (let i = 0; i < 30 && top === null; i++) {         // 等目标元素渲染出来
          top = await js(`(() => { const el = document.querySelector(${JSON.stringify(spec.to)}); if (!el) return null;
              const r = el.getBoundingClientRect(); return r.top + scrollY; })()`);
          if (top === null) await sleep(200);
        }
        if (top === null) throw new Error('找不到元素：' + spec.to);
        target = top - (spec.y ?? 400);
      }
      const max = await js(`document.documentElement.scrollHeight - innerHeight`);
      target = Math.max(0, Math.min(target, max));
      const start = await js('scrollY');
      const N = 9;
      for (let i = 1; i <= N; i++) {
        await js(`window.scrollTo(0, ${start + (target - start) * (i / N)})`);
        await sleep(45);
        await shot();
      }
      await sleep(150);
    }
    if (step.scroll) {
      // 只滚容器内部，绝不动整个窗口（scrollIntoView 会把页面也带走，图就被推出画面了）
      await js(`(() => { const el = document.querySelector(${JSON.stringify(step.scroll)}); if (!el) return;
          let box = el.parentElement;
          while (box && box.scrollHeight <= box.clientHeight + 4 && box !== document.body) box = box.parentElement;
          if (box && box !== document.body) {
            const er = el.getBoundingClientRect(), br = box.getBoundingClientRect();
            box.scrollTop += (er.top - br.top) - (br.height / 2 - er.height / 2);
          }
          window.scrollTo(0, 0); })()`);
      await sleep(250);
    }
    if (step.click) { const [x, y] = await resolve(step.click); await mouseClick(x, y); }
    if (step.type) {
      for (const ch of [...step.type]) { await send('Input.insertText', { text: ch }); await sleep(140); await shot(); }
    }
    if (step.key === 'Enter') {
      for (const t of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', { type: t, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: t === 'keyDown' ? '\r' : undefined });
      }
      await sleep(120);
    }
    if (step.drag) await dragRange(step.drag.from, step.drag.to);
    } catch (e) {
      console.error('  ✗ 步骤失败 ' + JSON.stringify(step) + ' → ' + e.message);
      throw e;
    }
  }
  const modalLog = await js(`(window.__modalLog || []).map(a => a[0] + 'ms ' + (a[1] ? '关闭' : '打开') + ' | ' + (a[2] || ''))`);
  if (modalLog.length) console.log('  ⚠ 弹窗变化：\n    ' + modalLog.join('\n    '));
  console.log(`  ${frameNo} 帧 → ${path.relative(ROOT, frameDir)}`);
  return { name, frames: frameNo };
}

/* ---------------- main ---------------- */
async function main() {
  const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!edge) throw new Error('找不到 Edge/Chrome');
  const server = await ensureServer();

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-tut-'));
  const proc = spawn(edge, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--disable-gpu', '--hide-scrollbars',
    `--window-size=${WIDTH},${HEIGHT}`, 'about:blank',
  ], { stdio: 'ignore' });

  let results = [];
  try {
    const url = await cdpConnect();
    ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result || {});
      }
    };
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    SESSION = sessionId;
    await send('Page.enable');
    // 探针：谁打开了/关掉了「选路线」弹窗？（带调用栈，早于页面任何脚本注入）
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { window.__modalLog = [];
        const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
        if (!d || !d.set) return;
        Object.defineProperty(HTMLElement.prototype, 'hidden', {
          get() { return d.get.call(this); },
          set(v) {
            if (this.id === 'spoiler-modal') {
              const stack = (new Error().stack || '').split('\\n').slice(1, 5).join(' <- ');
              window.__modalLog.push([Math.round(performance.now()), v, stack]);
            }
            d.set.call(this, v);
          },
          configurable: true, enumerable: d.enumerable,
        });
      })();`,
    });
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false, screenWidth: WIDTH, screenHeight: HEIGHT });

    for (const name of scenes) results.push(await runScene(name, SCENES[name]));
  } finally {
    try { ws && ws.close(); } catch { /* ignore */ }
    proc.kill();
    await sleep(600);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Edge 退出慢，忽略 */ }
    if (server) { try { server.kill(); } catch { /* ignore */ } }
  }

  console.log('\n帧已就绪。合成 GIF：');
  for (const r of results) {
    console.log(`  python scripts/assemble-gif.py --frames "${path.join(OUT, 'frames', r.name)}" --out "${path.join(OUT, r.name + '.gif')}"`);
  }
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
