/**
 * v0.215：按书覆盖词条（`meta.vocab`）＋ 层级标签（`meta.genLabels`）＋ 未支持书型的出口页。
 *
 * ## 用户反馈（v0.214 的讨论结论）
 * 现有的两种模板（叙事类 / 理论类）够不够覆盖传记 / 戏剧 / 议论文 / 科普 / 诗歌 / 散文？
 * 结论是：绝大多数书**只差几个词**（结局→历史定论、事件→论据），不值得新开第三套模板；
 * 真正需要另开一路的只有"诗歌/散文/工具书"—— 它们没有可图谱化的关系 ⇒ 明确不支持。
 *
 * ## 本测试守的三件事
 *  ① `meta.vocab` 覆盖**真的生效在界面上**（人物卡 + 「怎么用」⑬ —— 后者是**静态 HTML**
 *     那条路，专门咬"人物卡改口了、说明却还写旧词"这种同源病）；
 *  ② **不污染**别的书：切回没有 vocab 的书，词表与界面都要回到基表（与 v0.206 的
 *     `setTyped` 快照机制是同一族的坑 —— 覆盖值黏住不放）；
 *  ③ `meta.genLabels` 让层级印成「界/门/纲」而不是「第 1 代」，且页脚跨度文案跟着改；
 *  ④ 声明成未支持书型（`作品集`）的书 ⇒ 只给一页"为什么不做"，图区/时间轴/章节面板撤掉，
 *     **切回支持的书型要恢复**（否则用户被永久卡在一个空页里）。
 *
 * ## 为什么不往 data/ 里放一本"演示书"
 * 那样会污染书目与线上站点（books.json 是全站清单）。这里改成**服务端改写**：
 * 本地起的小服务在返回图包时给 meta 补上 vocab / genLabels / type，
 * 浏览器走的是**和真书一样的加载路径**（fetch → loadBook → applyTypeTerms → 渲染），
 * 仓库里一个字都不多。
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

/** 服务端改写：给这两本书的图包补上"本书自己的说法"。key 是图包路径，值是 meta 的补丁。 */
const PATCH = {
  '/data/three-kingdoms.graph.json': {
    /* 传记/史实类的典型覆盖：结局 → 历史定论、事件 → 战事（关系要挂"定义它的那件事"）。 */
    vocab: { fate: '历史定论', event: '战事' },
    /* 层级标签：假装这本书按"诗集/世代"编了号（科普的界门纲目科属是同一个机制）。 */
    genLabels: ['开国', '第二代', '第三代'],
  },
  '/data/crime-and-punishment.graph.json': { type: '作品集' },   // 显式声明"本书不做图谱"
};

const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const patch = PATCH[rel];
  if (patch) {
    const book = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    book.meta = Object.assign({}, book.meta, patch);
    rep.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    rep.end(JSON.stringify(book));
    return;
  }
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;
sweepStaleProfiles();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-vocab-'));
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

/** 打开一本书并等到面板/图建好 */
const openBook = async (slug) => {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=${slug}` });
  for (let i = 0; i < 300; i++) {
    if (await js(`!!(window.__ba && window.__ba.state.book && window.__ba.state.book.meta.slug === ${JSON.stringify(slug)})`).catch(() => false)) break;
    await wait(100);
  }
  await wait(1200);
};
/** 打开「怎么用」弹窗，取它自己的文案（不是欢迎面板的） */
const helpText = (sel) => js(`(() => {
  const btn = document.getElementById('help-btn');
  if (btn && document.getElementById('help-modal').hidden) btn.click();
  const el = document.querySelector('[data-term-html="${sel}"]');
  return el ? el.textContent : '';
})()`);

try {
  await send('Page.enable'); await send('Runtime.enable');

  /* ═══ ① vocab：覆盖真的落到界面上 ═══ */
  console.log('\n▶ ① meta.vocab：人物卡与「怎么用」都跟着改口');
  await openBook('three-kingdoms');
  const terms = await js(`(() => { const t = window.__ba.resolveTerms(); return { fate: t.fate, event: t.event, char: t.char, rel: t.rel }; })()`);
  console.log(`    词表：fate=「${terms.fate}」 event=「${terms.event}」 char=「${terms.char}」（char 应保持基表）`);
  ok(terms.fate === '历史定论', '词表：fate 被覆盖成「历史定论」');
  ok(terms.event === '战事', '词表：event 被覆盖成「战事」');
  ok(terms.char === '人物' && terms.rel === '关系', '没被覆盖的词保持基表（覆盖不该整表换掉）');

  /* 人物卡：「结局：」→「历史定论：」 */
  await js(`(() => {
    const hub = (window.__ba.state.book.characters||[]).slice()
      .sort((a,b)=>(b.aliases?b.aliases.length:0)-(a.aliases?a.aliases.length:0))[0];
    window.__ba.selectCharacter(hub.id);
  })()`);
  await wait(700);
  const card = await js(`(document.querySelector('#panel')||{}).textContent||''`);
  console.log(`    人物卡片段：${card.slice(0, 60).replace(/\\s+/g,' ')}…`);
  ok(/历史定论：/.test(card), '人物卡印「历史定论：」（而不是「结局：」）');
  ok(!/结局：/.test(card), '人物卡没有残留「结局：」');

  /* 「怎么用」⑬ 是**静态 HTML** 那条路 —— 它靠 setTyped 的 raw 分支才跟着改口。
   * ⚠ 这一条是本测试最关键的断言：人物卡改口而说明没改，就是 v0.213「图注不能说谎」同族。 */
  const h13 = await helpText('help13Body');
  console.log(`    怎么用⑬：${h13.slice(0, 46).replace(/\\s+/g,' ')}…`);
  ok(/历史定论/.test(h13), '「怎么用」⑬ 里的 {fate} 也变成「历史定论」（静态 HTML 那条路跟上了）');
  ok(!/结局/.test(h13), '「怎么用」⑬ 没有残留「结局」');
  const h12 = await helpText('help12Body');
  ok(/战事/.test(h12) || !/定义关系的小事件/.test(h12), '「怎么用」⑫ 的事件口径跟着覆盖（或本就没提事件）');

  /* ═══ ② 不污染别的书 ═══ */
  console.log('\n▶ ② 换到没有 vocab 的书：词表与界面都回基表');
  await openBook('crime-and-punishment');       // 这本**没**被服务端改写（默认路径）
  const back = await js(`(() => { const t = window.__ba.resolveTerms(); return { fate: t.fate, event: t.event, char: t.char }; })()`);
  ok(back.fate === '结局' && back.event === '事件', '词表回到基表（结局/事件）—— 覆盖值没有黏住');
  const kb = await js(`(document.getElementById('graph-kb-hint')||{}).textContent||''`);
  ok(/人物/.test(kb) && !/历史定论/.test(kb), '图键盘提示是叙事类原话（覆盖不外溢）');

  /* ═══ ③ genLabels：层级印成标签，不是「第 1 代」 ═══ */
  console.log('\n▶ ③ meta.genLabels：图注/页脚按本书的层级说话');
  await openBook('three-kingdoms');
  const gens = await js(`(() => ({
    g0: window.__ba.genText(0), g1: window.__ba.genText(1), g2: window.__ba.genText(2),
    g9: window.__ba.genText(9),
  }))()`);
  console.log(`    genText：0=「${gens.g0}」 1=「${gens.g1}」 9=「${gens.g9}」（越界应退化成「第 10 级」）`);
  ok(gens.g0 === '开国' && gens.g1 === '第二代', 'genText 按 genLabels 取标签');
  ok(/第 10 级/.test(gens.g9), 'genLabels 越界时退化成「第 N 级」（不印 undefined）');
  ok(!/第 1 代/.test(gens.g1), '没有残留「第 1 代」');
  const footer = await js(`(document.querySelector('.footer')||{}).textContent||''`);
  ok(/开国|第二代|第三代/.test(footer), '页脚跨度文案用了本书的层级名');
  ok(!/第 \\d+[–-]\\d+ 代/.test(footer), '页脚没有残留「第 X–Y 代」');

  /* ═══ ④ 未支持书型：出口页 + 切回能恢复 ═══ */
  console.log('\n▶ ④ 声明成「作品集」的书：一页说明，不画空图');
  await openBook('crime-and-punishment');
  const un = await js(`(() => ({
    flag: document.body.dataset.unsupported || '',
    graphHidden: getComputedStyle(document.querySelector('.graph-pane')).display === 'none',
    timelineHidden: getComputedStyle(document.querySelector('.timeline-panel')).display === 'none',
    note: (document.querySelector('.unsupported-note')||{}).textContent||'',
    nodes: window.__ba.nodeCount(),
    unsupported: window.__ba.unsupported(),
  }))()`);
  console.log(`    出口页：${un.note.trim().slice(0, 54).replace(/\\s+/g,' ')}…`);
  ok(un.flag === '1', 'body 上挂上了 unsupported 标记');
  ok(un.unsupported, 'JS 侧判据与 CSS 一致（确实走到了出口页）');
  ok(un.graphHidden && un.timelineHidden, '图区与时间轴都撤掉了（不给空图谱）');
  ok(/不做成图谱/.test(un.note), '右栏说明了「为什么不做」');
  ok(/人物|概念/.test(un.note) && /事件|案例/.test(un.note), '说明用当前词表（不是写死的词）');
  ok(un.nodes === 0, '没有建图（图元数 0）');

  console.log('\n▶ ⑤ 切回支持的书型：出口页要让位，不能把人永久卡住');
  await openBook('three-kingdoms');
  const rec = await js(`(() => ({
    flag: document.body.dataset.unsupported || '',
    graphHidden: getComputedStyle(document.querySelector('.graph-pane')).display === 'none',
    nodes: window.__ba.nodeCount(),
    fate: window.__ba.resolveTerms().fate,
  }))()`);
  ok(rec.flag === '', '切回支持的书型：unsupported 标记被清掉了');
  ok(!rec.graphHidden, '图区回来了');
  ok(rec.nodes > 100, `图真的建起来了（${rec.nodes} 个节点）`);
  ok(rec.fate === '历史定论', '切回三国：覆盖重新生效（词表是按书记的，不是全局的）');

  console.log(`\n${failed ? '✗' : '✓'} 按书覆盖与出口页：${passed} 通过，${failed} 失败`);
} catch (e) { failed++; console.error('异常：' + (e && e.stack || e)); }
releaseProfile(profile);
try { proc.kill(); } catch { /* 忽略 */ }
process.exit(failed ? 1 : 0);