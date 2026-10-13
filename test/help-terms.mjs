/**
 * v0.214：使用说明按书型分化（用户两条反馈的守军）。
 *
 * 用户原话：
 *   ① 把「点节点看人物档案 · 点连线看关系与「定义关系的小事件」…」（欢迎面板那段）
 *      **适配不同种类的书籍**重新优化；
 *   ② 「怎么用」里也重新优化使用说明。
 *
 * 背景：v0.206–v0.213 的理论类适配是"顶部加一句横幅 + 14 条图文照叙事类念"——
 * 「看这个人」「依据事件」「谁初次登场」在《刻意练习》上全是错的。v0.214 起：
 *   · 欢迎面板五段、右栏静态兜底、图键盘提示（sr-only）、「怎么用」14 条的标题与正文
 *     全部走 TERMS 句级词条（welcome 族 / panelHint / kbHint / help 各条 Head、Body / helpBottom）；
 *   · ⑧「虚线＝推导的亲属」只对叙事类成立 ⇒ 理论类整条隐藏；
 *   · 判据：G1/G2（两侧对称 + 命名占位符集合一致）、G10（静态词条不许带编号占位符）、
 *     G7（无死词条）—— 见 scripts/lib/type-terms.mjs，test/type-terms-guard.mjs 守。
 * 本文件守的是**渲染结果**（DOM 里真实出现的文字），两种书型各跑一遍，再切回叙事类
 * 验证 setTyped 快照机制不回退（v0.208「切回去写回理论类文案」那类病）。
 */
import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';
import { requireBrowser, browserArgs } from './browser-locator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = 0;
const CDP_PORT = await freePort();
const EDGE = requireBrowser();
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8' };
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;
sweepStaleProfiles();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-uin-'));
const proc = spawn(EDGE, [...browserArgs(), `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 240 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
if (!url) {
  console.error('  ✗ Edge 起来后连不上 CDP 端点 —— 这是**环境/负载**问题，不是断言失败。');
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
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, 30000);
});
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

/** 打开一本书并等到图建好（两种书型共用的 ready 判据） */
const openBook = async (slug) => {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=${slug}` });
  for (let i = 0; i < 300; i++) {
    if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book && window.__ba.state.pos.size > 0)`).catch(() => false)) break;
    await wait(100);
  }
  await wait(1200);
};
/** 打开「怎么用」弹窗，返回 { text, derivedHidden } */
const openHelp = () => js(`(() => {
  const btn = document.getElementById('help-btn');
  if (btn) btn.click();
  const modal = document.getElementById('help-modal');
  const item = document.querySelector('.help-item[data-help-item="derived"]');
  return {
    open: !!modal && !modal.hasAttribute('hidden'),
    text: (modal ? modal.textContent : '') || '',
    banner: (modal ? (modal.querySelector('.hint') || {}).textContent : '') || '',
    derivedHidden: !!item && getComputedStyle(item).display === 'none',
    head1: (modal ? modal.querySelector('[data-term-html="help1Head"]') : null) ? modal.querySelector('[data-term-html="help1Head"]').textContent : '',
    body1: (modal ? modal.querySelector('[data-term-html="help1Body"]') : null) ? modal.querySelector('[data-term-html="help1Body"]').textContent : '',
    head3: (modal ? modal.querySelector('[data-term-html="help3Head"]') : null) ? modal.querySelector('[data-term-html="help3Head"]').textContent : '',
    head4: (modal ? modal.querySelector('[data-term-html="help4Head"]') : null) ? modal.querySelector('[data-term-html="help4Head"]').textContent : '',
    body12: (modal ? modal.querySelector('[data-term-html="help12Body"]') : null) ? modal.querySelector('[data-term-html="help12Body"]').textContent : '',
    body13: (modal ? modal.querySelector('[data-term-html="help13Body"]') : null) ? modal.querySelector('[data-term-html="help13Body"]').textContent : '',
    body2: (modal ? modal.querySelector('[data-term-html="help2Body"]') : null) ? modal.querySelector('[data-term-html="help2Body"]').textContent : '',
    body10: (modal ? modal.querySelector('[data-term-html="help10Body"]') : null) ? modal.querySelector('[data-term-html="help10Body"]').textContent : '',
    bottom: (modal ? modal.querySelector('[data-term-html="helpBottom"]') : null) ? modal.querySelector('[data-term-html="helpBottom"]').textContent : '',
  };
})()`);

try {
  /* ═══ ① 叙事类（三国）：欢迎面板逐字保持 v0.213 的稿 ═══ */
  console.log('\n▶ ① 叙事类（three-kingdoms）：欢迎面板 / 键盘提示 / 怎么用');
  await openBook('three-kingdoms');
  const nar = await js(`(() => ({
    welcome: (document.querySelector('#panel .hint') || {}).textContent || '',
    kb: (document.getElementById('graph-kb-hint') || {}).textContent || '',
    aria: (document.getElementById('graph') || {}).getAttribute('aria-label') || '',
    label: (document.querySelector('.pathbar-label') || {}).textContent || '',
    axis: (document.querySelector('[data-term-html="axisTitle"]') || {}).textContent || '',
  }))()`);
  console.log(`    欢迎面板：「${nar.welcome.trim().slice(0, 60)}…」`);
  ok(/点节点看人物档案 · 点连线看关系与「定义关系的小事件」/.test(nar.welcome), '欢迎面板第一行：点节点看人物档案（叙事类原样）');
  ok(/工具条 \/ 两人关系 \/ 事件轴 \/ 右栏上拖是无效的/.test(nar.welcome), '欢迎面板：平移画布的边界说清了（含「两人关系」「事件轴」）');
  ok(/点任意一个人/.test(nar.welcome) && /依据事件/.test(nar.welcome), '欢迎面板：走丢自救与最短链两句是叙事类措辞');
  ok(/点任意一个人也会把视野拉回来/.test(nar.welcome), '欢迎面板：走丢自救是「点任意一个人」（不是「一个人物」）');
  ok(/打开上方「拖动节点」/.test(nar.welcome), '欢迎面板仍带开关限定（v0.213 不回归）');
  /* 说明里点名的控件，界面上必须真叫这个名字（v0.213「图注不能说谎」的同一类）。 */
  ok(nar.label === '两人关系', `底部控件标签＝两人关系（实测「${nar.label}」）`);
  ok(nar.welcome.includes(nar.label), '欢迎面板点到的底部控件名＝界面上真实标签');
  ok(nar.axis === '重大事件轴' && nar.welcome.includes('事件轴'), '轴标题＝重大事件轴，且欢迎面板说的是同一个轴');
  ok(!/概念|关联|案例|释义/.test(nar.welcome), '欢迎面板没有混进理论类词');
  /* 叙事类的**真身**是 index.html 原样（`setTyped` 的快照机制）⇒ 断言必须拿 HTML 比。
   * ⚠ 别拿术语表 `narrative` 那一侧比：那一侧是"同形句子的**文档**"，措辞与 HTML 有意不同
   *   （HTML「人太多看不清」/ 文档「人物太多看不清」；HTML「这个人」/ 文档「这个{char}」）。
   *   本测试第一版就是这么写的，于是三条断言对着文档判界面 —— 真界面对了，它反而红。 */
  const staticText = await js(`fetch('/index.html').then(r=>r.text()).then(h=>{
    const d = new DOMParser().parseFromString(h, 'text/html');
    const g = (sel) => { const el = d.querySelector(sel); return el ? el.textContent : ''; };
    return { kb: g('#graph-kb-hint'), head3: g('[data-term-html="help3Head"]'),
             body13: g('[data-term-html="help13Body"]'), bottom: g('[data-term-html="helpBottom"]') };
  })`);
  ok(nar.kb === staticText.kb, '叙事类键盘提示＝静态 HTML 原样（快照写回，无漂移）');
  ok(/方向键在人物之间移动/.test(nar.kb) && /回车打开这个人/.test(nar.kb), '图键盘提示（sr-only）是叙事类措辞');
  ok(!/{|\}/.test(nar.kb), '键盘提示里没有未填充的占位符');
  ok(/回车查看档案/.test(nar.aria), '#graph 的 aria-label 尾巴是叙事类措辞');

  const nh = await openHelp();
  ok(nh.open, '「怎么用」弹窗能打开');
  ok(/点节点＝人物档案/.test(nh.body1), '怎么用 ①：人物档案（叙事类）');
  ok(/三国可以搜「孔明/.test(nh.body2), '怎么用 ②：叙事类搜索示例');
  ok(nh.head3 === staticText.head3 && /人太多看不清/.test(nh.head3), '怎么用 ③ 标题＝静态 HTML 原样（人太多看不清）');
  ok(nh.head4 === '④ 拖动节点：把一个人拉出来，专门看与他有关的线', '怎么用 ④ 标题：把一个人拉出来（叙事类逐字）');
  ok(!/他的线|她的线/.test(nh.head4), '怎么用 ④ 标题没有领属人称');
  ok(/血缘/.test(nh.body12), '怎么用 ⑫：亲缘过滤族（叙事类才有）');
  ok(nh.body13 === staticText.body13 && /他\/她的一生（按章）/.test(nh.body13), '怎么用 ⑬＝静态 HTML 原样（他/她的一生，不写死性别）');
  ok(!nh.derivedHidden, '怎么用 ⑧（推导线）在叙事类可见');
  ok(nh.body10.includes('谁初次登场'), '怎么用 ⑩：谁初次登场（叙事类）');
  ok(nh.bottom.includes('点任意一个人'), '弹窗底注：点任意一个人（叙事类）');

  /* ═══ ② 理论类（peak）：整套换概念口径，⑧ 藏掉 ═══ */
  console.log('\n▶ ② 理论类（peak）：同一批文案换成概念口径');
  await openBook('peak');
  const the = await js(`(() => ({
    welcome: (document.querySelector('#panel .hint') || {}).textContent || '',
    kb: (document.getElementById('graph-kb-hint') || {}).textContent || '',
    aria: (document.getElementById('graph') || {}).getAttribute('aria-label') || '',
    label: (document.querySelector('.pathbar-label') || {}).textContent || '',
    axis: (document.querySelector('[data-term-html="axisTitle"]') || {}).textContent || '',
  }))()`);
  console.log(`    欢迎面板：「${the.welcome.trim().slice(0, 60)}…」`);
  ok(/点节点看概念释义 · 点连线看关联与「凭什么案例」/.test(the.welcome), '欢迎面板第一行：概念释义 / 凭什么案例');
  ok(/概念关系/.test(the.welcome) && /案例轴/.test(the.welcome), '欢迎面板：底部条与轴用概念口径');
  ok(/点任意一个概念/.test(the.welcome), '欢迎面板：走丢自救是「点任意一个概念」');
  ok(the.label === '概念关系', `底部控件标签＝概念关系（实测「${the.label}」）`);
  ok(the.welcome.includes(the.label), '理论类：欢迎面板点到的控件名＝界面上真实标签');
  ok(the.axis === '重大案例轴' && the.welcome.includes('案例轴'), '理论类：轴标题＝重大案例轴，且欢迎面板说的是同一个轴');
  ok(!/人物|事件|档案/.test(the.welcome), '欢迎面板没有残留叙事类词');
  ok(!/{|\}/.test(the.welcome), '欢迎面板没有未填充的占位符（fillNamed 真的填了）');
  ok(/方向键在概念之间移动/.test(the.kb) && /概念的释义/.test(the.kb), '图键盘提示（sr-only）是概念口径');
  ok(!/人物/.test(the.kb), '键盘提示没有残留「人物」');
  ok(/回车查看释义/.test(the.aria), '#graph 的 aria-label 尾巴是概念口径');

  const th = await openHelp();
  ok(/本书是理论类/.test(th.banner), '「怎么用」顶部仍有理论类提要横幅');
  ok(/点节点＝概念释义/.test(th.body1), '怎么用 ①：概念释义（理论类）');
  ok(/刻意练习可以搜「心理表征/.test(th.body2), '怎么用 ②：理论类搜索示例（换成了本书概念）');
  ok(th.head3 === '③ 概念太多看不清：三板斧 + 一键看清', '怎么用 ③ 标题：概念太多看不清');
  ok(th.head4 === '④ 拖动节点：把一个概念拉出来，专门看与它有关联的线', '怎么用 ④ 标题：把一个概念拉出来（不是「一个个概念」）');
  ok(/关联：全部/.test(th.body12) && !/血缘/.test(th.body12), '怎么用 ⑫：换成关联口径，不再提血缘');
  ok(/「沿革（按章）」小节/.test(th.body13), '怎么用 ⑬：「沿革（按章）」');
  ok(th.derivedHidden, '怎么用 ⑧（推导线）在理论类整条隐藏');
  ok(th.body10.includes('哪些概念初次提出'), '怎么用 ⑩：哪些概念初次提出');
  ok(th.bottom.includes('点任意一个概念'), '弹窗底注：点任意一个概念');
  /* ⚠ 量词式术语（`charN`='个概念'）被当泛指名词用，会印出「一个个概念」——
   *   这是 v0.214 施工中真实出现的病句（`一个{charN}` / `TW('welcomeLost', t.charN)`），
   *   当时 G1–G10 一条都不响。这里按**整段文本**兜住这一类。 */
  const theoryAll = th.text + the.welcome + the.kb;
  ok(!/个个/.test(theoryAll), '理论类全文没有「个个」这类叠量词病句');
  ok(!/一个个?概念/.test(theoryAll.replace(/一个概念/g, '')), '理论类没有「一个个概念」');
  ok(/(把|任意)一个概念/.test(theoryAll), '理论类确实用了「一个概念」这一正确形态');
  ok(!/人物/.test(th.body1 + th.body2 + th.body3 + th.body10 + th.body12 + th.body13), '抽查的六条正文没有残留「人物」');

  /* ═══ ③ 切回叙事类：setTyped 快照必须把原样写回去 ═══ */
  console.log('\n▶ ③ 切回叙事类：快照不回退');
  await openBook('three-kingdoms');
  const back = await js(`(() => ({
    welcome: (document.querySelector('#panel .hint') || {}).textContent || '',
    kb: (document.getElementById('graph-kb-hint') || {}).textContent || '',
  }))()`);
  ok(/点节点看人物档案/.test(back.welcome), '切回三国：欢迎面板回到人物口径');
  ok(!/概念|释义/.test(back.welcome), '切回三国：欢迎面板没有残留概念口径');
  ok(/方向键在人物之间移动/.test(back.kb), '切回三国：键盘提示回到人物口径');
  const backHelp = await openHelp();
  ok(!backHelp.derivedHidden, '切回三国：⑧（推导线）重新可见');
  ok(/点节点＝人物档案/.test(backHelp.body1), '切回三国：怎么用 ① 回到人物档案');

  /* ═══ ④ 静态 HTML（无 JS 兜底）仍带 data-term 挂点 ═══ */
  const staticHtml = await js(`fetch('/index.html').then((r) => r.text())`);
  ok(/data-term-html="panelHint"/.test(staticHtml || ''), '静态 HTML：右栏兜底挂了 panelHint');
  ok(/data-term="kbHint"/.test(staticHtml || ''), '静态 HTML：键盘提示挂了 kbHint');
  ok(/data-term-html="helpBottom"/.test(staticHtml || ''), '静态 HTML：弹窗底注挂了 helpBottom');
  ok(((staticHtml || '').match(/data-term-html="help\d+Body"/g) || []).length >= 10, '静态 HTML：10+ 条怎么用正文挂了术语词条');
  ok(/点节点看人物档案 · 点连线看关系/.test(staticHtml || ''), '静态 HTML：叙事类原文还在（setTyped 快照的真身）');

  console.log(`\n${failed ? '✗' : '✓'} 使用说明与书型适配：${passed} 通过，${failed} 失败`);
} catch (e) { failed++; console.error('异常：' + (e && e.stack || e)); }
releaseProfile(profile);
try { proc.kill(); } catch { /* 忽略 */ }
process.exit(failed ? 1 : 0);
