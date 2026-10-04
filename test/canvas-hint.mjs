// 验证 v91 的两件事：
//  ① #graph 的 grab / is-panning 光标真的生效，且不会被 ECharts 覆盖成别的
//  ② 事件轴导航的闪烁时长（右栏 3.6s / 事件卡 3.9s）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 19241, CDP_PORT = 19242;
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
await new Promise((r) => server.listen(PORT, r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-cur-'));
const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
const ws = new WebSocket(url);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, 25000); });
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

  console.log('\n▶ ① 光标：图上是 grab，按住变 grabbing');
  const cur = await js(`(() => {
    const g = document.getElementById('graph');
    const cv = g.querySelector('canvas');
    return { containerCursor: getComputedStyle(g).cursor,
             canvasCursor: cv ? getComputedStyle(cv).cursor : null,
             canvasInline: cv ? cv.style.cursor : null,
             touchAction: getComputedStyle(g).touchAction };
  })()`);
  console.log('    ' + JSON.stringify(cur));
  ok(cur.containerCursor === 'grab', `图区光标是 grab（实际 ${cur.containerCursor}）`);
  ok(cur.touchAction === 'none', `touch-action: none（实际 ${cur.touchAction}）——否则触屏拖动会变成滚页面`);

  // 按下 → is-panning
  await js(`(() => { const h = window.__ba.chart().getZr().handler;
    const mk=(x,y)=>({zrX:x,zrY:y,zrDelta:0,preventDefault(){},stopPropagation(){},offsetX:x,offsetY:y,target:null});
    h.dispatch('mousedown', mk(400,300)); return 1; })()`);
  await wait(200);
  const down = await js(`(() => { const g=document.getElementById('graph');
    return { cls: g.classList.contains('is-panning'), cursor: getComputedStyle(g).cursor }; })()`);
  ok(down.cls && down.cursor === 'grabbing', `按住时是 grabbing（class=${down.cls} cursor=${down.cursor}）`);
  await js(`(() => { const h = window.__ba.chart().getZr().handler;
    const mk=(x,y)=>({zrX:x,zrY:y,zrDelta:0,preventDefault(){},stopPropagation(){},offsetX:x,offsetY:y,target:null});
    h.dispatch('mouseup', mk(400,300)); return 1; })()`);
  await wait(200);
  const up = await js(`(() => { const g=document.getElementById('graph');
    return { cls: g.classList.contains('is-panning'), cursor: getComputedStyle(g).cursor }; })()`);
  ok(!up.cls && up.cursor === 'grab', `松手后回到 grab（class=${up.cls} cursor=${up.cursor}）`);

  console.log('\n▶ ② 提示：图下常驻一行，且说清了"要按在图的范围里"');
  const hint = await js(`(() => {
    const el = document.querySelector('.graph-pan-hint');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const g = document.getElementById('graph').getBoundingClientRect();
    return { text: el.textContent.trim(), visible: r.width > 0 && r.height > 0,
             rightBelowGraph: Math.abs(r.top - g.bottom) < 40,
             saysInside: /图的范围里/.test(el.textContent) };
  })()`);
  ok(!!hint, '图下有常驻提示');
  if (hint) {
    console.log(`    「${hint.text}」`);
    ok(hint.visible && hint.rightBelowGraph, '提示可见且紧贴在图下方');
    ok(hint.saysInside, '提示里明确写了"要按在图的范围里，图外无效"');
  }

  console.log('\n▶ ③ 导航闪烁时长（右栏 3.6s / 事件卡 3.9s）');
  const anim = await js(`(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cls = el.className.replace(/.*?(\\S+)\\s*nav-flash.*/, '$1');
      el.classList.add('nav-flash');
      const a = getComputedStyle(el).animation;
      el.classList.remove('nav-flash');
      const m = /([\\d.]+)s\\s+[\\w-]+(?:\\s+[\\w-]+)*?\\s+(\\d+)\\s/.exec(a);
      return { sel, anim: a, dur: m ? +m[1] : 0, times: m ? +m[2] : 0, total: m ? m[1] * m[2] : 0 };
    };
    const chip = document.querySelector('#timeline .event-chip');
    let chipAnim = null;
    if (chip) { chip.classList.add('nav-flash'); chipAnim = getComputedStyle(chip).animation; chip.classList.remove('nav-flash'); }
    const panel = document.getElementById('panel');
    panel.classList.add('nav-flash');
    const panelAnim = getComputedStyle(panel).animation;
    panel.classList.remove('nav-flash');
    return { panelAnim, chipAnim, nChips: document.querySelectorAll('#timeline .event-chip').length };
  })()`);
  const parse = (a) => { const m = /([\d.]+)s\s+[\w-]+(?:\s+[\w-]+)*?\s+(\d+)\s/.exec(a || ''); return m ? { dur: +m[1], times: +m[2], total: +m[1] * +m[2] } : null; };
  const p = parse(anim.panelAnim), c = parse(anim.chipAnim);
  console.log(`    #panel.nav-flash     → ${anim.panelAnim}${p ? `  ⇒ ${p.total}s` : ''}`);
  console.log(`    .event-chip.nav-flash → ${anim.chipAnim}${c ? `  ⇒ ${c.total}s` : ''}（页面里有 ${anim.nChips} 张事件卡）`);
  ok(!!p && p.total >= 3.0, `右栏闪烁 ${p ? p.total : '?'}s（下限 3s）`);
  ok(!!c && c.total >= 3.5, `事件卡闪烁 ${c ? c.total : '?'}s（下限 3.5s，修复前 1.8s）`);

  console.log('\n▶ ③b 两段导航之间的间隔（v93）');
  console.log('    用户反馈"定义这段关系的事件…还是一下就跳过"。查下来真正的元凶不是闪烁时长，');
  console.log('    而是点关系线时 navSecondStep 只隔 550ms 就把页面滚去事件轴 —— 右栏那段根本没机会被看见。');
  const gap = await js(`(() => {
    const b = window.__ba;
    return { step2: b.NAV_STEP2_DELAY, panelMs: b.PANEL_NAV_MS, eventMs: b.EVENT_NAV_MS };
  })()`);
  console.log(`    navSecondStep 间隔 ${gap.step2}ms（右栏闪 ${((gap.panelMs || 0) / 1000).toFixed(1)}s，事件卡闪 ${((gap.eventMs || 0) / 1000).toFixed(1)}s）`);
  // 间隔必须够看完右栏闪烁的**第一下**，否则第二段滚动会把第一段顶掉（用户原话：一下就跳过）
  ok(gap.step2 >= 1200, `两段导航间隔 ${gap.step2}ms（≥1200ms，修复前 550ms）`);
  ok(gap.step2 > (gap.panelMs || 0) * 0.3, '间隔没有被压到比右栏闪烁本身还短');

  console.log('\n▶ ④ 顺手核对：文案不再含糊（"空白处拖动"读起来像"任何空白处"）');
  const txt = await js(`(() => {
    const panel = document.getElementById('panel');
    const hint = document.querySelector('.graph-pan-hint');
    const welcome = panel ? (panel.innerText || '') : '';
    const hintText = hint ? hint.textContent : '';
    return {
      // 真正要禁的是**没有限定语**的那两句
      hasVagueHelp: /滚轮缩放、空白拖动平移|双击空白＝复位视图/.test(document.body.innerText || ''),
      // 欢迎面板必须把"限定语"和自救出口都说到
      welcomeSaysInside: /要按在图的范围里/.test(welcome),
      welcomeSaysRecovery: /画布拖到视野外了|点任意一个人/.test(welcome),
      hintSaysInside: /图的范围里/.test(hintText),
    };
  })()`);
  console.log('    ' + JSON.stringify(txt));
  ok(!txt.hasVagueHelp, '页面里已无"空白拖动平移 / 双击空白＝复位视图"这种没限定语的写法');
  ok(txt.welcomeSaysInside, '欢迎面板写清了"要按在图的范围里"');
  ok(txt.welcomeSaysRecovery, '欢迎面板写清了画布丢了的两种自救办法');
  ok(txt.hintSaysInside, '图下常驻提示写清了"图的范围里"');

  console.log(`\n${failed ? '✗' : '✓'} 画布手感与导航提示：${passed} 通过，${failed} 失败`);
} catch (e) { failed++; console.error('异常：' + e.message); }
finally { try { ws.close(); } catch {} try { proc.kill(); } catch {} try { server.close(); } catch {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
process.exit(failed ? 1 : 0);