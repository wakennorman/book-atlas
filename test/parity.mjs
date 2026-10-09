#!/usr/bin/env node
/**
 * 三份实现的一致性对拍（js/app.js ⇄ shared/graph-core.js ⇄ miniprogram/utils/graph.js）。
 *
 * 为什么需要它
 * ------------
 * 同一套"这本书里谁可见 / 谁被剧透锁住 / 分到哪一组"的判定逻辑，在三个文件里各手抄了一份：
 *   · js/app.js                  —— 网页版（线上真正跑的）
 *   · miniprogram/utils/graph.js —— 小程序
 *   · shared/graph-core.js        —— "参考实现"，只被 test/core.mjs 引用，线上没有任何地方用
 *
 * 三份已经漂移过：v85 修「分组要按当前归属而不是最终归属」时只改了 app.js，
 * 另外两份照旧按 c.faction 分组 —— 于是网页版对了、小程序错了，而当时所有测试都是绿的
 * （core.mjs 对 groupKeyOf 只断言 typeof === 'string'）。
 *
 * 这个脚本在真实浏览器里拿网页版的实现，和另外两份在真实数据上逐个函数、逐条边对拍。
 * 任何一份改了而另外两份没改（或者改出了不同的结果），这里就会失败。
 *
 * 依赖：window.__ba._predicates()（app.js 里纯函数谓词集合，见该处注释）
 * 用法：node test/parity.mjs
 */
import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createGraphCore } from '../shared/graph-core.js';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';
import { requireBrowser } from './browser-locator.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = 0;   // v0.97：临时端口，listen 之后回填
const CDP_PORT = await freePort();

const EDGE = requireBrowser();

const SLUGS = ['one-hundred-years-of-solitude', 'crime-and-punishment', 'three-kingdoms'];
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

/* ---------------- 本地静态服务 ---------------- */
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  /* Cache-Control: no-store —— 别删，但要知道它**不是**修过某个真 bug。
   *
   * 加它是因为 v0.96 排查时发现：15 个测试服务器里 10 个带 no-store，
   * 这 5 个（parity/browser/editor/races/e2e）没有 ⇒ 浏览器可能喂给测试 HTTP 缓存里的旧
   * data/*.json。这是**潜在漏洞**，不是当时那个失败的成因。
   *
   * 当时 parity 报「25 处 网页版 vs graph-core 不一致」的**真因是另一个**：
   * 网页端 loadBook 优先 fetch meta.graphFile（data/*.graph.json 生成物），
   * 而那个文件是旧的（磁盘上的 data/*.json 已经改好），跑 make-slim-packs.mjs 之后就好了。
   *
   * 留这个头的价值：**下次真出现「测试说数据不一致、磁盘上明明一致」时，
   * 可以先把缓存层排除掉**，不用重新怀疑一遍。 */
rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;   // v0.97：临时端口

/* ---------------- 在 Node 侧把另两份实现准备好 ---------------- */
const miniGraph = require(path.join(ROOT, 'miniprogram', 'utils', 'graph.js'));

function buildCore(factory, book, stateOverrides) {
  const byId = new Map(book.characters.map((c) => [c.id, c]));
  const adj = new Map(book.characters.map((c) => [c.id, []]));
  const deg = new Map(book.characters.map((c) => [c.id, 0]));
  for (const r of book.relations) {
    if (!byId.has(r.from) || !byId.has(r.to)) continue;
    adj.get(r.from).push({ to: r.to, rel: r });
    adj.get(r.to).push({ to: r.from, rel: r });
    deg.set(r.from, (deg.get(r.from) || 0) + 1);
    deg.set(r.to, (deg.get(r.to) || 0) + 1);
  }
  // 两份参考实现的 state 用数组存筛选；app.js 用 Set
  const st = {
    progress: null, chapter: 1, timeTravel: false,
    showMinor: false, showMentioned: false, showDerived: true,
    sizeFilter: 'all', focus: null,
    edgeStyles: [], edgeKins: [],
    a11yPalette: false, fontSize: 'm',
    ...stateOverrides,
  };
  return factory({ pack: book, adj, byId, deg, state: st });
}

/** 小程序的 createGraph 签名不同：createGraph(pack) —— 它自己建索引、自己造 state。
 *  所以要用小程序自己的数据包（miniprogram/data/*.js，含预计算的 degree），
 *  再把 state 覆盖成与另外两份相同的值。 */
function buildMini(slug, stateOverrides) {
  const pack = require(path.join(ROOT, 'miniprogram', 'data', `${slug}.js`));
  const g = miniGraph.createGraph(pack);
  Object.assign(g.state, {
    progress: null, chapter: 1, timeTravel: false, showDerived: true,
    edgeStyles: [], edgeKins: [],
    ...stateOverrides,
  });
  return g;
}

/* ---------------- 起浏览器 ---------------- */
sweepStaleProfiles();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-parity-'));
const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--disable-gpu', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }

let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));  /* v0.115：CDP 响应不来时 pending 条目永不 settle ⇒ 静默挂死。 */ setTimeout(() => { if (pending.delete(id)) reject(new Error(method + ' 30 秒无响应')); }, 30000);});

try {
/* ⚠ 连不上 CDP 时必须**在这里**报错退出，不能往下走。
 *
 * 下面是 `new WebSocket(url)` 加一个只监听 onopen/onerror 的 promise ——
 * url 拿不到时它是 null，连不上时那个 promise **永远不 settle**，
 * 于是进程静默挂死：stdout / stderr **0 字节**，没有异常、没有退出码，
 * 看起来像"卡在某个断言上"，其实一条断言都还没开始跑。
 * 实测在门禁里撞过两次，每次要等十几分钟超时才发现。
 * （v0.100 把这道防线补齐到所有走 CDP 的测试文件。）
 */
if (!url) {
  console.error('  ✗ Edge 起来后连不上 CDP 端点 —— 这是**环境/负载**问题，不是断言失败。');
  console.error('    多半是刚借到的临时端口被别的进程抢走了（借出到 Edge 抢占之间有个毫秒级窗口，');
  console.error('    见 test/_free-port.mjs 的说明）—— 重跑一次通常就好。');
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  releaseProfile(profile);
  process.exit(1);
}

  ws = new WebSocket(url);
  await Promise.race([

    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }),

    new Promise((_, rej) => setTimeout(() => rej(new Error('CDP WebSocket 10 秒内没连上')), 10000)),

  ]);
  ws.onmessage = (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); }
  };
  const js = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');

  // 对拍的状态网格：覆盖剧透进度 / 时间旅行 / 边过滤 / 族谱开关
  const GRID = [
    { label: '全解锁', o: { progress: null } },
    { label: '剧透=5', o: { progress: 5 } },
    { label: '剧透=10', o: { progress: 10 } },
    { label: '剧透=30', o: { progress: 30 } },
    { label: '剧透=10+只亲缘', o: { progress: 10, edgeKins: ['blood'] } },
    { label: '剧透=10+虚线', o: { progress: 10, edgeStyles: ['dashed'] } },
    { label: '剧透=10+关族谱', o: { progress: 10, showDerived: false } },
    { label: '时间旅行@8', o: { progress: null, timeTravel: true, chapter: 8 } },
    { label: '剧透=20+旅行@6', o: { progress: 20, timeTravel: true, chapter: 6 } },
  ];

  // 需要对拍的纯函数（两边都有同名实现）
  const FN = ['chOf', 'charCh', 'relCh', 'relFrom', 'lockedCh', 'charLocked', 'relLocked',
    'eventLocked', 'eventChOf', 'eventVisibleAt', 'charVisibleAt', 'relVisibleAt', 'relVisible',
    'passEdgeFilter', 'symbolSize', 'groupKeyOf', 'groupLabelOf', 'effectiveFactionKey',
    'charLastCh', 'fateLocked', 'periodText', 'maxChapter'];

  // 聚焦（focusSet）：三份的 state 形状不同（app 的 state 挂在 __ba 上、还带 focusCache），
  // 所以每次现建一个实例再问它，不做任何缓存。
  // v85 之前 app.js 的 focusSet 漏查 relVisible，关掉「族谱补全」聚焦时会多出一批
  // "只靠推导边连到"的人，而那些边在图上并不画 ⇒ 悬空节点（实测三国共 50999 个）。
  const focusOf = async (book, o, side) => {
    if (side === 'web') {
      return js(`(() => {
        const st = window.__ba.state;
        // ⚠ 先把 GRID 循环留下的状态清干净：前面 9 轮依次改过 progress / timeTravel /
        //   edgeStyles / edgeKins / showDerived / showMentioned / showMinor / sizeFilter / focus，
        //   其中任何一个残留都会让 focusSet 的结果和另两份对不上（实测残留 focusCache 时是 22）。
        st.focus = null; st.focusCache = null;
        st.progress = null; st.timeTravel = false; st.chapter = 1;
        st.showDerived = ${o.showDerived !== false};
        st.showMinor = false; st.showMentioned = false;
        st.sizeFilter = 'all'; st.placeFilter = null; st.activeFaction = null;
        window.__ba.applyEdgeFilter([], []);
        st.focus = { id: ${JSON.stringify(o.focusId)}, depth: ${o.depth} };
        const s = window.__ba.focusSet();
        st.focus = null; st.focusCache = null;
        return s;
      })()`);
    }
    if (side === 'core') {
      const st = { progress: null, chapter: 1, timeTravel: false, showDerived: o.showDerived !== false, edgeStyles: [], edgeKins: [], focus: { id: o.focusId, depth: o.depth } };
      const core = buildCore(createGraphCore, book, st);
      const s = core.focusSet();
      return s ? [...s] : null;
    }
    const g = buildMini(o.slug, { showDerived: o.showDerived !== false });
    g.state.focus = { id: o.focusId, depth: o.depth };
    const s = g.focusSet();
    return s ? [...s] : null;
  };

  for (const slug of SLUGS) {
    const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${slug}.json`), 'utf8'));
    console.log(`\n▶ ${book.meta.title}（${slug}）· ${book.characters.length} 人 / ${book.relations.length} 关系`);

    // 切到这本书
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=${slug}` });
    for (let i = 0; i < 120; i++) {
      if (await js(`!!(window.__ba && window.__ba.state.book && window.__ba.state.book.meta.slug === ${JSON.stringify(slug)} && window.__ba.state.chart)`).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const ready = await js(`window.__ba && window.__ba.state.book.meta.slug === ${JSON.stringify(slug)}`);
    if (!ready) { ok(false, `${slug}：页面加载失败`); continue; }

    const mismatches = [];
    // 找一个关系最多的人做聚焦测试的锚点（和 app.js 里挑 hub 的口径一致）
    const adj0 = new Map(book.characters.map((c) => [c.id, 0]));
    for (const r of book.relations) {
      if (adj0.has(r.from)) adj0.set(r.from, adj0.get(r.from) + 1);
      if (adj0.has(r.to)) adj0.set(r.to, adj0.get(r.to) + 1);
    }
    for (const g of GRID) {
      const core = buildCore(createGraphCore, book, g.o);
      const mp = buildMini(slug, g.o);
      // 网页版：设置同样的状态后取它的实现
      await js(`(() => {
        const st = window.__ba.state;
        st.progress = ${JSON.stringify(g.o.progress ?? null)};
        st.timeTravel = ${JSON.stringify(!!g.o.timeTravel)};
        st.chapter = ${JSON.stringify(g.o.chapter ?? 1)};
        st.showDerived = ${JSON.stringify(g.o.showDerived !== false)};
        window.__ba.applyEdgeFilter(${JSON.stringify(g.o.edgeStyles || [])}, ${JSON.stringify(g.o.edgeKins || [])});
      })()`);

      const web = await js(`(() => {
        const P = window.__ba._predicates();
        const b = window.__ba.state.book;
        const out = {};
        for (const c of b.characters) {
          out[c.id] = [P.charCh(c), P.charLocked(c), P.charVisibleAt(c), P.groupKeyOf(c),
                       P.groupLabelOf(c), P.effectiveFactionKey(c), P.charLastCh(c), P.fateLocked(c)];
        }
        const rel = {};
        for (const r of b.relations) {
          rel[r.from + '|' + r.to + '|' + r.type] =
            [P.relCh(r), P.relFrom(r), P.relLocked(r), P.relVisibleAt(r), P.relVisible(r),
             P.passEdgeFilter(r), P.periodText(r), P.visibleRelEvents(r).length];
        }
        return { chars: out, rels: rel, maxChapter: P.maxChapter(), asOf: P.asOf() };
      })()`);

      // 参考实现侧
      const ref = { chars: {}, rels: {} };
      for (const c of book.characters) {
        ref.chars[c.id] = [core.charCh(c), core.charLocked(c), core.charVisibleAt(c), core.groupKeyOf(c),
          core.groupLabelOf(c), core.effectiveFactionKey(c), core.charLastCh(c), core.fateLocked(c)];
      }
      for (const r of book.relations) {
        ref.rels[r.from + '|' + r.to + '|' + r.type] =
          [core.relCh(r), core.relFrom(r), core.relLocked(r), core.relVisibleAt(r), core.relVisible(r),
           core.passEdge(r), core.periodText(r), core.visibleRelEvents(r).length];
      }

      let bad = 0; let firstMsg = '';
      for (const [k, v] of Object.entries(ref.chars)) {
        const w = web.chars[k];
        if (!w) { bad++; firstMsg = firstMsg || `人物 ${k} 网页版缺失`; continue; }
        if (JSON.stringify(v) !== JSON.stringify(w)) {
          bad++;
          if (!firstMsg) {
            const nm = book.characters.find((c) => c.id === k)?.name || k;
            firstMsg = `${nm} core=[${v}] web=[${w}]`;
          }
        }
      }
      for (const [k, v] of Object.entries(ref.rels)) {
        const w = web.rels[k];
        if (!w) { bad++; firstMsg = firstMsg || `关系 ${k} 网页版缺失`; continue; }
        if (JSON.stringify(v) !== JSON.stringify(w)) {
          bad++;
          if (!firstMsg) firstMsg = `关系 ${k} core=[${v}] web=[${w}]`;
        }
      }
      // 小程序：groupKeyOf / groupLabelOf / effectiveFactionKey 三项单独对（其余差异见文件内注释）
      let mpBad = 0, mpMsg = '';
      for (const c of book.characters) {
        const k1 = mp.groupKeyOf(c), k2 = core.groupKeyOf(c);
        const l1 = mp.groupLabelOf(c), l2 = core.groupLabelOf(c);
        const e1 = mp.effectiveFactionKey(c), e2 = core.effectiveFactionKey(c);
        if (k1 !== k2 || l1 !== l2 || e1 !== e2) {
          mpBad++;
          if (!mpMsg) mpMsg = `${c.name} mini=[${k1}/${l1}/${e1}] core=[${k2}/${l2}/${e2}]`;
        }
      }

      if (bad) mismatches.push(`${g.label}: 网页版 vs graph-core ${bad} 处不同（首例 ${firstMsg}）`);
      if (mpBad) mismatches.push(`${g.label}: 小程序 vs graph-core ${mpBad} 处不同（首例 ${mpMsg}）`);
      ok(bad === 0, `${g.label} · 网页版 ⇄ graph-core 全等`);
      ok(mpBad === 0, `${g.label} · 小程序 ⇄ graph-core 分组口径一致`);
    }

    /* ---- 聚焦集合（focusSet）单独对：v85 之前 app.js 漏查 relVisible，
     * 关掉「族谱补全」再聚焦时，会多出一批"只靠推导边连到"的人，
     * 而那些边在图上并不画 ⇒ 变成没有连线的悬空节点（实测三国共 50999 个）。
     * 这个断言与 GRID 无关（聚焦只看 showDerived 与锁），所以放在循环外跑一次。 ---- */
    const hub = book.characters.slice().sort((a, b) => ((adj0.get(b.id) || 0) - (adj0.get(a.id) || 0)))[0];
    if (hub) {
      for (const depth of [1, 2, 3]) {
        for (const derived of [true, false]) {
          const o = { slug, focusId: hub.id, depth, showDerived: derived };
          const webF = await focusOf(book, o, 'web');
          const coreF = await focusOf(book, o, 'core');
          const miniF = await focusOf(book, o, 'mini');
          const s = (x) => JSON.stringify([...(x || [])].sort());
          const tag = `${book.meta.title} 聚焦「${hub.name}」${depth} 跳${derived ? '' : ' + 关族谱补全'}`;
          const same = s(webF) === s(coreF);
          const sameMini = s(webF) === s(miniF);
          if (!same) mismatches.push(`${tag}: 网页版与 graph-core 不同（web=${(webF||[]).length} core=${(coreF||[]).length}）`);
          if (!sameMini) mismatches.push(`${tag}: 网页版与小程序不同（web=${(webF||[]).length} mini=${(miniF||[]).length}）`);
          ok(same && sameMini, `${tag} · 三份一致（${(webF || []).length} 人）`);
        }
      }
    }

    /* ---- v89：锁定可见集合（neighborhoodNodes / edgesWithin）三份对拍。
     * 这两个是"锁定时图上只画哪些点与线"的唯一口径，网页版 buildOption、参考实现、
     * 小程序 graph.js 各有一份手抄。任何一份改了而另两份没改，锁定后的图就会不一样。
     * （锁定本身只画集合内的东西，所以这里错一点点 = 用户看到的人/线就不一样。） ---- */
    const lockViewOf = async (book, o, side) => {
      const nodesIn = JSON.stringify(o.nodes);
      if (side === 'web') {
        return js(`(() => {
          const st = window.__ba.state;
          st.focus = null; st.focusCache = null;
          st.progress = null; st.timeTravel = false; st.chapter = 1;
          st.showDerived = ${o.showDerived !== false};
          st.showMinor = false; st.showMentioned = false;
          st.sizeFilter = 'all'; st.placeFilter = null; st.activeFaction = null;
          window.__ba.applyEdgeFilter([], []);
          const nodes = window.__ba.neighborhoodNodes(${JSON.stringify(o.startId)}, ${o.depth});
          const edges = window.__ba.edgesWithin(nodes);
          return { nodes, edges };
        })()`);
      }
      if (side === 'core') {
        const st = { progress: null, chapter: 1, timeTravel: false, showDerived: o.showDerived !== false, edgeStyles: [], edgeKins: [], focus: null };
        const core = buildCore(createGraphCore, book, st);
        const nodes = [...core.neighborhoodNodes(o.startId, o.depth)];
        return { nodes, edges: [...core.edgesWithin(new Set(nodes))] };
      }
      const g = buildMini(o.slug, { showDerived: o.showDerived !== false });
      const nodes = [...g.neighborhoodNodes(o.startId, o.depth)];
      return { nodes, edges: [...g.edgesWithin(new Set(nodes))] };
    };

    // 起点用两个人物对（有并行边）和一个 hub，覆盖"邻域很小"与"邻域很大"两种
    const starts = [hub];
    const multiPair = (() => {
      const key = new Map();
      for (const r of book.relations) {
        const k = [r.from, r.to].sort().join('|');
        key.set(k, (key.get(k) || 0) + 1);
      }
      for (const [k, n] of key) {
        if (n < 2) continue;
        const id = k.split('|').find((x) => book.characters.some((c) => c.id === x));
        if (id) { starts.push(book.characters.find((c) => c.id === id)); break; }
      }
      return key;
    })();

    for (const start of starts.filter(Boolean)) {
      for (const depth of [1, 2]) {
        for (const derived of [true, false]) {
          const o = { slug, startId: start.id, depth, showDerived: derived };
          const webV = await lockViewOf(book, o, 'web');
          const coreV = await lockViewOf(book, o, 'core');
          const miniV = await lockViewOf(book, o, 'mini');
          const sN = (x) => JSON.stringify([...(x.nodes || [])].sort());
          const sE = (x) => JSON.stringify([...(x.edges || [])].sort());
          const tag = `${book.meta.title} 锁定「${start.name}」${depth} 跳${derived ? '' : ' + 关族谱补全'}`;
          const sameN = sN(webV) === sN(coreV) && sN(webV) === sN(miniV);
          const sameE = sE(webV) === sE(coreV) && sE(webV) === sE(miniV);
          if (!sameN) mismatches.push(`${tag}: 邻域节点集三份不同（web=${(webV.nodes||[]).length} core=${(coreV.nodes||[]).length} mini=${(miniV.nodes||[]).length}）`);
          if (!sameE) mismatches.push(`${tag}: 集合内边集三份不同（web=${(webV.edges||[]).length} core=${(coreV.edges||[]).length} mini=${(miniV.edges||[]).length}）`);
          ok(sameN && sameE, `${tag} · 三份一致（${(webV.nodes || []).length} 人 / ${(webV.edges || []).length} 边）`);
        }
      }
    }

    if (mismatches.length) {
      console.error('    ↳ 差异明细：');
      for (const m of mismatches) console.error('      ' + m);
    }
  }
} catch (e) {
  failed++;
  console.error('  ✗ 对拍异常：' + e.message);
} finally {
  try { ws && ws.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  releaseProfile(profile);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`三份实现对拍　通过：${passed}  失败：${failed}`);
process.exit(failed > 0 ? 1 : 0);
