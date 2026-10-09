import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';
import { requireBrowser } from './_browser.mjs';

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

/* v0.132：浮动按钮的**位置语义**断言。
 * 起因：v0.131 按钮挂在 .graph-pane 下、top:10px，和工具条同一行 ⇒
 * 视觉上落在「按地点筛选」旁边，用户读成"又一个筛选控件"，不知道是全屏。
 * ⇒ 现在包在只含 #graph 的 .graph-stage 里，必须断言按钮**落在画布矩形内**。 */
const floatPos = () => js(`(() => {
  const ft = document.querySelector('.graph-float-tools');
  const g = document.getElementById('graph').getBoundingClientRect();
  const f = ft.getBoundingClientRect();
  const cs = getComputedStyle(ft);
  return {
    insideX: f.left >= g.left - 1 && f.right <= g.right + 1,
    insideY: f.top >= g.top - 1 && f.bottom <= g.bottom + 1,
    offsetParent: ft.offsetParent ? ft.offsetParent.className : null,
    btnBottomGap: Math.round(g.bottom - f.bottom),
    graphTop: Math.round(g.top), graphBottom: Math.round(g.bottom),
    ftTop: Math.round(f.top), ftLeft: Math.round(f.left),
    position: cs.position,
  };
})()`);

const readState = () => js('window.__ba.fullscreenState()');
const geom = () => js(`(() => {
  const g = document.getElementById('graph');
  const r = g.getBoundingClientRect();
  const head = document.getElementById('pane-head-tools');
  const hr = head ? head.getBoundingClientRect() : null;
  const side = document.getElementById('side-panel');
  const cs = side ? getComputedStyle(side) : null;
  const sr = side ? side.getBoundingClientRect() : null;
  return {
    graphH: Math.round(r.height), graphW: Math.round(r.width),
    graphRight: Math.round(r.right),
    inlineHeight: g.style.height || '(空)',
    headPos: head ? getComputedStyle(head).position : null,
    headDisplay: head ? getComputedStyle(head).display : null,
    headTop: hr ? Math.round(hr.top) : null,
    sideDisplay: cs ? cs.display : null,
    sideVisible: sr ? sr.width > 0 : null,
    sideW: sr ? Math.round(sr.width) : null,
    sideLeft: sr ? Math.round(sr.left) : null,
    mainCols: getComputedStyle(document.querySelector('main')).gridTemplateColumns,
    vh: window.innerHeight, vw: window.innerWidth,
  };
})()`);

/* v0.131b 新增：**遮挡断言**。
 *
 * 第一版 33 条断言全绿，但用户实机一看是坏的 —— 因为只测了「机械属性」：
 *   · 只查 side 的 display 是不是 none，没查它**有多宽**、**有没有盖住画布**
 *   · 只查工具条能被点到，没查它**是不是压在密图上**
 * 于是「右栏 800px 盖满整行」「工具条 42% 透明度叠字」两个真问题全漏过去。
 *
 * ⇒ 这里补两类断言：
 *   ① 横向遮挡：右栏宽度必须受限，且不能盖住画布
 *   ② 工具条：收起时 display:none；展开时背景**不透明**（压在图上必须能读）
 */
const occlusion = () => js(`(() => {
  const g = document.getElementById('graph').getBoundingClientRect();
  const side = document.getElementById('side-panel');
  const head = document.getElementById('pane-head-tools');
  const sr = side.getBoundingClientRect();
  const sVis = getComputedStyle(side).display !== 'none' && sr.width > 0;
  const hDisp = getComputedStyle(head).display;
  const hBg = getComputedStyle(head).backgroundColor;
  // alpha 通道：rgba(...,a) 的 a，或 4 位 #rrggbbaa
  const m = hBg.match(/rgba?\\([^)]*?,\\s*([\\d.]+)\\)$/);
  let alpha = 1;
  if (m) alpha = Number(m[1]);
  return {
    graphW: Math.round(g.width), graphRight: Math.round(g.right),
    sideVisible: sVis, sideW: Math.round(sr.width), sideLeft: Math.round(sr.left),
    // 右栏是否横向盖住画布（两者有交集面积）
    sideOverlapsGraph: sVis && sr.left < g.right - 1 && sr.right > g.left + 1,
    headDisplay: hDisp, headBg: hBg, headAlpha: alpha,
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
  const toolsHiddenAtStart = await js(`document.getElementById('tools-btn').hidden`);
  ok(toolsHiddenAtStart === true, '不在全屏时，工具条折叠按钮是隐藏的（工具条本来就在文档流里）');
  ok(g.inlineHeight !== '(空)', `不在全屏时画布高度由 JS 写 inline（当前 ${g.inlineHeight}）`);

  /* v0.132：按钮必须落在画布内，不能和工具条混在一行 */
  console.log('\n▶ ①b 浮动按钮落在**画布内**（v0.132 位置修正）');
  let fp = await floatPos();
  ok(fp.offsetParent === 'graph-stage', `按钮的定位上下文是 .graph-stage（当前 ${fp.offsetParent}）`);
  ok(fp.position === 'absolute', `按钮是 absolute 定位（${fp.position}）`);
  ok(fp.insideX, `按钮横向在画布内（按钮 ${fp.ftLeft}，画布右边 ${Math.round(fp.ftLeft + 0)}）`);
  ok(fp.insideY, `★ 按钮纵向在画布内（按钮 top=${fp.ftTop}，画布 ${fp.graphTop}~${fp.graphBottom}）—— 这一条正是 v0.131 违反的`);
  /* 关键回归点：按钮不能和工具条同一行。工具条在画布上方，按钮在画布内 ⇒ 必然 ftTop > graphTop。 */
  ok(fp.ftTop > fp.graphTop, `按钮在画布**内部**而非工具条那一行（按钮 ${fp.ftTop} > 画布顶 ${fp.graphTop}）`);

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
  const toolsBtnShown = await js(`document.getElementById('tools-btn').hidden`);
  ok(toolsBtnShown === false, '全屏里工具条折叠按钮出现了');
  const btnTxt2 = await js(`document.getElementById('fullscreen-btn').textContent.trim()`);
  ok(btnTxt2.includes('退出'), `按钮文案切成「${btnTxt2}」`);
  ok(Math.abs(s.zoom - preFs.zoom) < 0.05, `进全屏时 zoom 保留（${preFs.zoom.toFixed(4)} → ${s.zoom.toFixed(4)}）`);
  ok(Math.abs(s.center[0] - preFs.center[0]) < 2 && Math.abs(s.center[1] - preFs.center[1]) < 2,
    `进全屏时 center 保留（${JSON.stringify(preFs.center)} → ${JSON.stringify(s.center)}）`);

  /* ---- v0.131b：默认全收起 ---- */
  console.log('\n▶ ②b 进全屏默认「全收起」（v0.131b 改）');
  ok(s.sideHidden === true, `右栏默认收起（sideHidden=${s.sideHidden}）`);
  ok(s.bodyClass.includes('side-hidden'), `body 带 side-hidden（${s.bodyClass}）`);
  ok(s.headCollapsed === true, `工具条默认收起（headCollapsed=${s.headCollapsed}）`);
  ok(s.bodyClass.includes('head-collapsed'), `body 带 head-collapsed（${s.bodyClass}）`);
  let occ = await occlusion();
  ok(occ.headDisplay === 'none', '收起时工具条 display:none（完全让给图）');
  ok(occ.sideVisible === false, '收起时右栏不可见');
  ok(occ.sideOverlapsGraph === false, '收起时右栏不遮画布');
  /* 这条是第一版**完全没有**的：图有多宽。
     收起后画布应该就是整个视口宽 —— 不该有任何东西占掉宽度。 */
  ok(occ.graphW >= occ.graphW, `收起时画布占满宽度（${occ.graphW}px）`);
  ok(g.graphW >= g.vw - 2, `收起时画布宽＝视口宽（${g.graphW} / ${g.vw}）`);

  console.log('\n▶ ③ 工具条：点「⚙ 工具」才展开，展开后不透明且可点');
  /* v0.131b 改：默认收起 → 先展开再验。展开后的关键属性是
     **背景不透明**（第一版 0.42 压在 881 点密图上完全读不了）。 */
  await js('window.__ba.toggleHeadCollapsed()');
  await wait(700);
  s = await readState(); g = await geom();
  occ = await occlusion();
  ok(s.headCollapsed === false, '展开后 headCollapsed=false');
  ok(g.headDisplay !== 'none', `工具条重新出现（display=${g.headDisplay}）`);
  ok(g.headPos === 'absolute', `工具条仍浮在画布上（position=${g.headPos}）`);
  ok(occ.headAlpha >= 0.95, `工具条背景**不透明**（alpha=${occ.headAlpha}，背景 ${occ.headBg}）—— 压在密图上必须能读`);
  const headPE = await js(`getComputedStyle(document.getElementById('pane-head-tools')).pointerEvents`);
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
    const b = document.querySelector('#pane-head-tools [data-view="gen-v"]');
    if (!b) return 'no-btn';
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    return top === b || b.contains(top) ? 'hit' : ('covered-by:' + (top && top.className));
  })()`);
  ok(hitOk === 'hit', `工具条上的视图切换按钮真的能点到（${hitOk}）`);
  // 收回去，后面的用例从"全收起"这个默认态继续
  await js('window.__ba.toggleHeadCollapsed()');
  await wait(600);
  ok((await readState()).headCollapsed === true, '再点一次能收回去');

  console.log('\n▶ ④ 右栏：默认收起，点「▤ 右栏」展开，且**限宽不遮图**');
  await js('window.__ba.toggleSideHidden()');
  await wait(1000);
  s = await readState(); g = await geom(); occ = await occlusion();
  ok(s.sideHidden === false, 'state.sideHidden=false（已展开）');
  ok(!s.bodyClass.includes('side-hidden'), 'body 不再带 side-hidden');
  ok(occ.sideVisible === true, '右栏可见');
  /* ★ 第一版漏掉的关键两条。实测第一版在 800×586 下右栏宽 800px，
     因为栅格单列后 aside 撑满整行，把画布整个盖住。 */
  ok(occ.sideW <= 400, `右栏限宽（${occ.sideW}px）`);
  ok(occ.sideOverlapsGraph === false, '右栏**不遮住**画布（这是第一版的真 bug）');
  ok(occ.graphW > 0 && occ.graphRight <= occ.sideLeft + 1, `画布右边缘 ${occ.graphRight} ≤ 右栏左边缘 ${occ.sideLeft}`);
  await js('window.__ba.toggleSideHidden()');
  await wait(1000);
  s = await readState(); g = await geom();
  ok(s.sideHidden === true && g.sideDisplay === 'none', '再点一次能收回去');

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

  /* ---- ★ 窄视口：这一节是第一版**完全没有**、也是真 bug 唯一暴露的地方 ----
   *
   * 第一版 33 条断言全绿，但用户实机（视口 800×586）一看是坏的：
   * 右栏撑到 800px 把画布整个盖住。第一版测试跑在 1600×1000，
   * 那个宽度下 aside 撑满也只占一部分，看起来"正常" ⇒ 漏过去了。
   *
   * ⇒ 同一个会话里把视口改到 800×586 再验一遍。宽度是最容易出问题的维度，
   *   窄视口必须单独测，不能只靠宽视口"顺便"覆盖。 */
  console.log('\n▶ ⑨ ★ 窄视口 800×586（第一版全绿却不可用的那个场景）');
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 586, deviceScaleFactor: 1, mobile: false });
  await wait(1200);
  let gn = await geom();
  ok(gn.vw === 800, `视口已切到 800×586（${gn.vw}×${gn.vh}）`);

  await js('window.__ba.toggleFullscreen(true)');
  await wait(1600);
  s = await readState(); gn = await geom(); let occn = await occlusion();
  ok(s.fullscreen === true, '窄视口下能进全屏');
  ok(s.sideHidden === true && s.headCollapsed === true, '窄视口下默认仍是「全收起」');
  ok(occn.headDisplay === 'none', '窄视口收起时工具条 display:none');
  ok(occn.sideVisible === false, '窄视口收起时右栏不可见');
  ok(gn.graphH >= gn.vh - 2, `窄视口下画布仍吃满高度（${gn.graphH} / ${gn.vh}）`);
  ok(gn.graphW >= gn.vw - 2, `窄视口收起时画布宽＝视口宽（${gn.graphW} / ${gn.vw}）`);

  // 展开右栏：这是第一版真正坏掉的地方
  await js('window.__ba.toggleSideHidden()');
  await wait(1200);
  gn = await geom(); occn = await occlusion();
  ok(occn.sideVisible === true, '窄视口下右栏能展开');
  ok(occn.sideW <= 400, `★ 窄视口下右栏仍限宽（${occn.sideW}px）—— 第一版这里是 800px，把画布整个盖住`);
  ok(occn.sideOverlapsGraph === false, `★ 窄视口下右栏不遮画布 —— 这是第一版的真 bug`);
  ok(occn.graphRight <= occn.sideLeft + 1, `画布右边缘 ${occn.graphRight} ≤ 右栏左边缘 ${occn.sideLeft}`);
  ok(occn.graphW > 100, `画布还剩可用宽度（${occn.graphW}px），不是被挤没了`);

  await js('window.__ba.toggleFullscreen(false)');
  await wait(1000);
  await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  await wait(600);
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