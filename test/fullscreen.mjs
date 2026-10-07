import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';

/* v0.131：全屏展示。
 *
 * 守住的东西（每条都对应一个真实的坏法）：
 *   ① 进出全屏的 class 状态正确，Esc 能退出
 *   ② **视野必须保留** —— 容器尺寸一变，onResize → resetRoam(false) 会把 zoom 归 1、
 *      center 归 [0,0]（v93 的机制）。不还原的话用户"刚调好的视角"就没了。
 *      这是最容易漏、也最容易被当成"本来就这样"的一条。
 *   ③ 画布真的铺满（不是"看起来像铺满"）—— 量 clientHeight 对比视口
 *   ④ 右栏可折叠：折叠后 main 变单列，且折叠按钮只在全屏里出现
 *   ⑤ 工具条浮化但**仍可点**（pointer-events 不能被关掉 —— 上面有搜索框和视图切换）
 *   ⑥ 不全屏时 Esc 的原行为不受影响（这个项目 Esc 是"取消选中"，不能被抢）
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = 0;
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
PORT = server.address().port;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-fs-'));
const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });

const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
if (!url) { console.log('  (跳过) 拿不到 CDP'); process.exit(0); }

const ws = new WebSocket(url);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, 30000); });
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

const readState = () => js('window.__ba.fullscreenState()');
const geom = () => js(`(() => {
  const g = document.getElementById('graph');
  const r = g.getBoundingClientRect();
  const head = document.querySelector('.pane-head');
  const hr = head ? head.getBoundingClientRect() : null;
  const side = document.getElementById('side-panel');
  const cs = side ? getComputedStyle(side) : null;
  return {
    graphH: Math.round(r.height), graphW: Math.round(r.width),
    inlineHeight: g.style.height || '(空)',
    headPos: head ? getComputedStyle(head).position : null,
    headTop: hr ? Math.round(hr.top) : null,
    sideDisplay: cs ? cs.display : null,
    sideVisible: side ? (side.getBoundingClientRect().width > 0) : null,
    mainCols: getComputedStyle(document.querySelector('main')).gridTemplateColumns,
    vh: window.innerHeight, vw: window.innerWidth,
  };
})()`);

try {
  sweepStaleProfiles();
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=one-hundred-years-of-solitude` });
  for (let i = 0; i < 300; i++) { if (await js(`!!(window.__ba && window.__ba.state.chart)`).catch(() => false) === true) break; await wait(100); }
  await wait(4000);

  console.log('\n▶ ① 初始：不在全屏，按钮文案与可见性');
  let s = await readState();
  let g = await geom();
  ok(!s.fullscreen, '初始不在全屏');
  const btnTxt = await js(`document.getElementById('fullscreen-btn').textContent.trim()`);
  ok(btnTxt.includes('全屏') && !btnTxt.includes('退出'), `全屏按钮文案是「${btnTxt}」`);
  ok(await js(`document.getElementById('fullscreen-btn').getAttribute('aria-pressed')`) === 'false', 'aria-pressed=false');
  const sideHiddenAtStart = await js(`document.getElementById('side-btn').hidden`);
  ok(sideHiddenAtStart === true, '不在全屏时，右栏折叠按钮是隐藏的（右栏本来就一直显示）');
  ok(g.inlineHeight !== '(空)', `不在全屏时画布高度由 JS 写 inline（当前 ${g.inlineHeight}）`);

  console.log('\n▶ ② 进全屏：class + 画布铺满 + 高度交给 CSS');
  /* 先给一个非默认视野，用来验证"进全屏"这一步本身不改用户的视角 */
  await js('window.__ba.applyZoom(1.85, [60, -30])');
  await wait(1000);
  const preFs = await readState();
  await js('window.__ba.toggleFullscreen(true)');
  await wait(1600);
  s = await readState(); g = await geom();
  ok(s.fullscreen === true, 'state.fullscreen=true');
  ok(s.bodyClass.includes('fullscreen'), `body 带 fullscreen 类（${s.bodyClass}）`);
  ok(g.graphH >= g.vh - 2, `画布高度吃满视口（${g.graphH} / 视口 ${g.vh}）`);
  ok(g.inlineHeight === '(空)', 'inline height 被清空了（否则和 CSS 的 100% 打架）');
  const sideBtnShown = await js(`document.getElementById('side-btn').hidden`);
  ok(sideBtnShown === false, '全屏里右栏折叠按钮出现了');
  const btnTxt2 = await js(`document.getElementById('fullscreen-btn').textContent.trim()`);
  ok(btnTxt2.includes('退出'), `按钮文案切成「${btnTxt2}」`);
  ok(Math.abs(s.zoom - preFs.zoom) < 0.05, `进全屏时 zoom 保留（${preFs.zoom.toFixed(4)} → ${s.zoom.toFixed(4)}）`);
  ok(Math.abs(s.center[0] - preFs.center[0]) < 2 && Math.abs(s.center[1] - preFs.center[1]) < 2,
    `进全屏时 center 保留（${JSON.stringify(preFs.center)} → ${JSON.stringify(s.center)}）`);

  console.log('\n▶ ③ 工具条浮化但仍可点');
  ok(g.headPos === 'absolute', `工具条浮化成 absolute（当前 ${g.headPos}）`);
  const headPE = await js(`getComputedStyle(document.querySelector('.pane-head')).pointerEvents`);
  ok(headPE !== 'none', `工具条没有被关掉鼠标事件（pointer-events=${headPE}）—— 上面有搜索框和视图切换`);
  /* ⚠ 必须先把欢迎遮罩关掉再测命中。
   * 第一版忘了这步，elementFromPoint 命中的是 `.modal-backdrop`（欢迎层），
   * 报成「工具条被挡」—— 那是**测试自己**的问题，不是全屏的锅。
   * 教训：命中测试要先排除无关的顶层遮罩，否则量到的不是被测对象。 */
  await js(`(() => {
    for (const sel of ['.modal-backdrop', '#welcome-modal', '.modal']) {
      for (const el of document.querySelectorAll(sel)) {
        if (getComputedStyle(el).display !== 'none' && el.querySelector('button')) { el.style.display = 'none'; }
      }
    }
    document.querySelectorAll('.modal-backdrop').forEach((e) => { e.style.display = 'none'; });
    return true;
  })()`);
  await wait(300);
  const hitOk = await js(`(() => {
    const b = document.querySelector('.pane-head [data-view="gen-v"]');
    if (!b) return 'no-btn';
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    return top === b || b.contains(top) ? 'hit' : ('covered-by:' + (top && top.className));
  })()`);
  ok(hitOk === 'hit', `工具条上的视图切换按钮真的能点到（${hitOk}）`);

  console.log('\n▶ ④ 右栏折叠（仅全屏内）');
  ok(g.sideVisible === true && g.sideDisplay !== 'none', '默认右栏展开');
  await js('window.__ba.toggleSideHidden()');
  await wait(1000);
  s = await readState(); g = await geom();
  ok(s.sideHidden === true, 'state.sideHidden=true');
  ok(s.bodyClass.includes('side-hidden'), `body 带 side-hidden 类（${s.bodyClass}）`);
  ok(g.sideDisplay === 'none', '右栏 display:none');
  ok(g.mainCols.split(' ').length === 1, `main 变单列（gridTemplateColumns=${g.mainCols}）`);
  await js('window.__ba.toggleSideHidden()');
  await wait(1000);
  s = await readState(); g = await geom();
  ok(s.sideHidden === false && g.sideVisible === true, '再点一次能展开回来');

  console.log('\n▶ ⑤ 视野保留（本节最容易漏 —— 尺寸一变 resetRoam 会把 zoom 冲成 1）');
  /* 语义：**在全屏里**调好视野，退出后应保留。
   * ⚠ 第一版这里写成"进全屏前 zoom=2.6，退出后应还是 2.6"，
   *   并且实现存的是"进全屏前的视野"—— 结果用户在全屏里放大看完细节，
   *   一退出就被还原成进全屏前的旧值。那是**设计错**：退出全屏的语义应该是
   *   "换个看法继续看同一处"，不是"丢弃你刚才的调整"。两处一起改对了。 */
  await js('window.__ba.applyZoom(2.6, [120, -80])');
  await wait(1000);
  const inFs = await readState();
  ok(Math.abs(inFs.zoom - 2.6) < 0.05, `全屏内 zoom 调到 2.6（实测 ${inFs.zoom.toFixed(4)}）`);
  ok(Math.abs(inFs.center[0] - 120) < 2 && Math.abs(inFs.center[1] + 80) < 2,
    `全屏内 center 是 [120,-80]（实测 ${JSON.stringify(inFs.center)}）`);
  await js('window.__ba.toggleFullscreen(false)');
  await wait(1600);
  const after = await readState();
  ok(Math.abs(after.zoom - inFs.zoom) < 0.05, `退出全屏后 zoom 保留（${inFs.zoom.toFixed(4)} → ${after.zoom.toFixed(4)}）`);
  ok(Math.abs(after.center[0] - inFs.center[0]) < 2 && Math.abs(after.center[1] - inFs.center[1]) < 2,
    `退出全屏后 center 保留（${JSON.stringify(inFs.center)} → ${JSON.stringify(after.center)}）`);
  const g3 = await geom();
  ok(g3.graphH < g.vh - 2, `退出全屏后画布不再铺满（${g3.graphH}）`);
  ok(g3.inlineHeight !== '(空)', `退出全屏后 inline height 交还给 JS（${g3.inlineHeight}）`);

  console.log('\n▶ ⑥ Esc 能退出全屏');
  await js('window.__ba.toggleFullscreen(true)');
  await wait(900);
  ok((await readState()).fullscreen === true, '先确认已在全屏');
  /* 派一个真实键盘事件（不是调 API）—— 走的是用户实际按键那条路。 */
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(1200);
  ok((await readState()).fullscreen === false, 'Esc 退出了全屏');

  console.log('\n▶ ⑦ 不全屏时 Esc 的原行为不受影响');
  /* 这个项目 Esc 本来是"取消选中/退出锁定"。全屏逻辑带 if (!state.fullscreen) return，
     所以不全屏时不该有任何拦截。这里验证：不在全屏时按 Esc 不进也不退全屏。 */
  await js('window.__ba.selectCharacter("jose-arcadio-buendia")').catch(() => {});
  await wait(700);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(800);
  s = await readState();
  ok(s.fullscreen === false, '不在全屏时按 Esc 不会误进全屏（也不该退出——本来就不在全屏）');

  console.log('\n▶ ⑧ 全屏里搜索/锁定仍可用');
  await js('window.__ba.toggleFullscreen(true)');
  await wait(1200);
  await js(`(() => { const e = document.getElementById('search-input'); e.value = '乌尔苏拉'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(400);
  await js(`document.getElementById('search-go').click()`);
  await wait(2200);
  const lockedInFs = await js(`!!window.__ba.state.clickLock`);
  ok(lockedInFs === true, '全屏里搜索能建锁（操作没被全屏破坏）');
  const lockedView = await readState();
  ok(lockedInFs && lockedView.fullscreen === true, '建锁后仍停留在全屏（没被踢出）');
  await js('window.__ba.toggleFullscreen(false)');
  await wait(1200);
} catch (e) {
  failed++;
  console.error('  ✗ 异常：' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
} finally {
  try { ws.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
  server.close();
  releaseProfile(profile);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`全屏展示　通过：${passed}  失败：${failed}`);
process.exit(failed ? 1 : 0);