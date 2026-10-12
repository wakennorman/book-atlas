#!/usr/bin/env node
/**
 * 【长期】发布门禁每轮都跑（v0.198 新增，见 check.yml「首屏性能预算」一步）
 * 守卫：**首屏性能预算**
 *
 * ## 为什么要有这条
 *
 * `test/browser.mjs` 从v85 起就在测首屏耗时，但它拿到 `window.__baPerf` 之后
 * **只 `console.log`、不 `ok()`** ——
 * 实测那个文件里`perf` 只出现在一行日志里，断言一条都没有。
 *
 * ⇒ 首屏从 0.8 秒劣化到 3 秒，**门禁全绿**。
 * 一个「量了但不管」的指标等于没量：它只会在有人手工看日志时才有价值，
 * 而 CI 日志没人看。
 *
 * 而这个项目的性能**完全不受门禁保护**：
 * 实测 `grep -rn '性能预算|budget' js/ scripts/` **零命中**，
 * 也就是说不存在任何阈值、任何基线、任何告警。
 *
 * ## 为什么要立基线文件而不是把数字写死在代码里
 *
 * 机器快慢差好几倍（CI 的 ubuntu runner vs 本机 Windows），
 * 写死的毫秒数换台机器就全红。
 * ⇒ 数字放`data/perf-baseline.json`，`--bless` 实测后落盘，
 * 判定用「相对基线的倍数」而不是绝对毫秒。
 *
 * ## ⚠ 阈值怎么定才算不是"永远绿"
 *
 * 单纯「不许变慢」会在正常优化/劣化间反复红。两档：
 * · `warn`（>1.5×）：**不算失败**，只提示 —— 覆盖不同机器的抖动。
 * · `fail`（>2.5×）：**报红** —— 这个幅度不可能是机器差异，
 *   只可能是数据变大、渲染路径变慢、或某个 O(n²) 被引进来了。
 *
 * 实测波动（同机连续三次，三国首屏到图可交互）：
 * 1349 / 1287 / 1402 ms ⇒ 抖动约±5%，所以 1.5× 足够宽松、2.5× 足够灵敏。
 *
 * ## ⚠ v0.200：这条守卫自己也有「量了不管」的那一段
 *
 * 第一版只判 `wallMs`，把 `totalBytes` / `jsonBytes` **量了落进基线就不管了**
 * —— 与本文件开头批评 `browser.mjs` 的是同一条毛病，自己犯了。
 * 传输量恰恰是**最不该不管**的那个：它没有机器差异（不依赖 CPU / 时钟），
 * 数据变胖就是真变胖。
 *
 * ⇒ v0.200 补两条判定，且**刻意用两套判据**：
 *   · `wallMs` → 相对**倍数**（跨机器差好几倍，写死毫秒换台机器就全红）
 *   · 字节数 → 相对**倍数**但阈值更紧（1.5× / 1.25×），因为它不该抖
 *
 * ⚠ 而 `totalBytes` 与 `jsonBytes` 量的**不是同一件事**，必须分开判：
 *   实测三本书 `totalBytes` 离散度只有 2.0%，**非 JSON 部分三本完全相同**
 *   （都 1505 KB）—— 它量的是 echarts + app.js + css 那套**固定骨架**，
 *   有人往 index.html 里多加一个 `<script>` 就会动它。
 *   `jsonBytes` 才是每本书各不相同的**数据文件**。
 *   ⚠ 别把它们合成一个"总传输量"阈值：那样加一个全局库反而不会红，
 *     而数据文件悄悄胖 30% 也不会红 —— 两头都漏。
 *
 * 用法：
 *   node test/perf-budget.mjs            # 比对基线（有基线才有效）
 *   node test/perf-budget.mjs --bless    # 实测并写入基线
 *   node test/perf-budget.mjs --no-browser  # CI 无浏览器时跳过（但会明确说明跳了）
 */
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { freePort } from './_free-port.mjs';
import { releaseProfile, sweepStaleProfiles } from './_profile-guard.mjs';
import { requireBrowser, browserArgs } from './browser-locator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'data', 'perf-baseline.json');

/** 超过基线这个倍数就只是提示。覆盖机器差异（本机实测抖动 ±5%）。 */
const WARN = 1.5;
/** 超过这个倍数报红。这个幅度不可能是机器差异。 */
const FAIL = 2.5;

/** 测哪几本。选最大的三本里最重的 —— 小书永远快，测了也没信息。 */
const BOOKS = [
  { slug: 'three-kingdoms', label: '三国（886 人 / 2338 边，全项目最重）' },
  { slug: 'one-hundred-years-of-solitude', label: '百年孤独（66 人）' },
  { slug: 'crime-and-punishment', label: '罪与罚（38 人）' },
];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

console.log('══ 首屏性能预算 ══\n');

const BLESS = process.argv.includes('--bless');

/* ───────────────────────── 静态服务器 ───────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

/** 真实静态托管会为这些类型开 gzip（GitHub Pages 对 .js/.css/.json 都开）。
 *  ⚠ 图片/字体已经压缩过，再 gzip 是浪费 —— 不列进来。 */
const COMPRESSIBLE = /\.(json|js|mjs|css|html|svg|webmanifest|xml|txt)$/;

function serve() {
  return new Promise((res) => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); return rq.end(); }
      const body = fs.readFileSync(f);
      const hdrs = { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' };
      /* 文本类资源走 gzip，模拟真实静态托管（GitHub Pages / Nginx 默认都开）。
       * ⚠ 不开就量的是"本地磁盘读文件"，比真实网络快一个量级，测出来没意义。
       *
       * ⚠⚠ v0.200 更正：**第一版只给 `.json` 开 gzip，`.js` / `.css` / `.html` 全是明文** ——
       *   而 `vendor/echarts.min.js` 一个人就有 1007 KB、`js/app.js` 361 KB。
       *   ⇒ `totalBytes` 一直在量**未压缩的 JS**，却把输出标成「网络传输走gzip」。
       *   实测证据：那三本书的 `totalBytes` 非 JSON 部分**完全相同（1505 KB）**，
       *   正是 echarts(1007)+app.js(361)+css(54)+其余 ≈ 明文字节数。
       *   ⇒ 这个数既不等于真实传输量、也不能用来判断"骨架有没有变胖"
       *     （gzip 后 echarts 只有 327 KB，差 3 倍）。
       *   GitHub Pages 对 .js 也开 gzip，所以这里必须跟真实托管一致。 */
      if (COMPRESSIBLE.test(f) && body.length > 1024) {
        const gz = gzipSync(body, { level: 9 });
        hdrs['Content-Encoding'] = 'gzip';
        rq.writeHead(200, { ...hdrs, 'Content-Length': gz.length });
        return rq.end(gz);
      }
      rq.writeHead(200, hdrs);
      rq.end(body);
    });
    s.listen(0, '127.0.0.1', () => res({ srv: s, port: s.address().port }));
  });
}

/* ───────────────────────── CDP 连接（含重试） ───────────────────────── */

/**
 * ⚠⚠ **Edge 的 `exitCode=0` 是假象** —— 主进程立即返回，真正的浏览器在子进程里。
 *   所以「spawn 出来的进程退出了」**不能**当作失败依据（本轮在这上面绕了一圈）。
 *   必须真的去敲 CDP。
 *
 * 而 `freePort()` 是「借来再关掉」，Edge 抢占前有毫秒级竞态窗口
 *（`test/_free-port.mjs` 文件头自己写了这个坑）⇒ 必须重试，不能只试一次。
 */
function cdpUrl(port, attempt = 0) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('CDP 重试 20 次仍连不上')), 20000);
    const req = http.get({ host: '127.0.0.1', port, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
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
    req.on('error', () => {
      clearTimeout(t);
      if (attempt >= 19) { rej(new Error('CDP 重试 20 次仍连不上')); return; }
      setTimeout(() => cdpUrl(port, attempt + 1).then(res, rej), 1000);
    });
  });
}

/* ───────────────────────── 实测 ───────────────────────── */

async function measure() {
  const { srv, port } = await serve();
  const cdpPort = await freePort();
  /* ⚠ **清扫要放到后台，不能让它挡住测量。**
   *
   * `sweepStaleProfiles()` 是**同步**的，且它内部会拉 PowerShell 查进程表
   *   —— 实测 `%TEMP%` 里积了几十个 `ba-*` 时，单次清扫能跑 **22 分钟**
   *   （v0.198 第一版就撞上了：bless 时 28 秒，加了清扫后同一个守卫跑超2 分钟，
   *    而那时 Edge 进程数是 0 ⇒ 卡的就是它）。
   *
   * 而清扫本身**不是这条守卫的职责**：它由 `test/browser.mjs` 等测试负责，
   *   本守卫只是不该被它拖住。
   * ⇒ 用 `setImmediate` 让它与测量并行，测完不等它。
   *   ⚠ 未捕获的异常会让进程挂掉，所以挂一个空 catch。 */
  setImmediate(() => {
    try { sweepStaleProfiles(); } catch { /* 清扫失败与性能无关 */ }
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-perf-'));
  const proc = spawn(requireBrowser(), [...browserArgs(),
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1400,900', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    /* v0.205.1：`await import('ws')` 是**从来没跑通过**的一行 —— `ws` 不在 package.json
     * 里（本机 node_modules 也没有），v0.198 写下这行起，浏览器模式下必崩；
     * 以前没人发现是因为 CI 从 v0.172 起 startup_failure、本地也没人完整跑过门禁。
     * 按 v0.165.5 的既定决策改用 Node 22 全局 WebSocket（其余 19 个浏览器测试同款）。 */
    const ws = new WebSocket(await cdpUrl(cdpPort));
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('CDP WebSocket 连不上'));
    });
    let seq = 0;
    const pending = new Map();
    const net = new Map();
    ws.onmessage = (ev) => {
      const d = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
      if (d.method === 'Network.responseReceived') {
        net.set(d.params.requestId, { url: d.params.response.url, bytes: 0 });
      }
      if (d.method === 'Network.loadingFinished') {
        const e = net.get(d.params.requestId);
        if (e) e.bytes = d.params.encodedDataLength;
      }
    };
    const send = (method, params = {}) => new Promise((rs) => {
      const i = ++seq; pending.set(i, rs);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    await send('Network.enable', {});
    await send('Page.enable', {});
    await send('Runtime.enable', {});
    /* ⚠⚠ v0.205.1：**挡掉 sw.js** —— 这是字节计数四连跳的根因。
     *
     * 这四变（v0.200 前三变 + 本次）共同点：量到“哪些 .json 走了网络”随机跳 ——
     * 百年孤独的 jsonBytes 在 基线 53.5 / 本机 39.3 / CI 11.3 KB 之间跳，
     * 罪与罚则稳定高出期望 ~2×（text 包被 SW 的后台刷新**数了两遍**）。
     * `textStatus==='done'` 只证明“解析完了”，SW 缓存命中时根本没有网络记录可计；
     * 而 v0.198 的“每本前清 storage”清得掉缓存、清不干净注册时序。
     *
     * ⇒ 语义上这本来就是**冷启动**（新访客第一次打开，那时还没有 SW）——
     *   那就别让 SW 存在：挡掉 sw.js，所有抓取直走网络，graph/text 各计一次，
     *   字节数变成完全确定值（= 服务器 gzip(level 9) 后的包大小）。
     *   wallMs 不受影响（每本前本来就清了缓存，量的一直是冷启动）。 */
    await send('Network.setBlockedURLs', { urls: ['*sw.js'] });

    const out = {};
    for (const b of BOOKS) {
      /* ⚠⚠ **每本书都必须清掉缓存 + Service Worker**，否则只测得到第一本。
       *
       * 实测第一版：三国 JSON 86.6 KB，百年孤独 **0.0 KB**、罪与罚 **0.0 KB** ——
       * 因为 sw.js 对 `/data/` 走 stale-while-revalidate，
       * 第二本书直接命中 Cache Storage、**一个字节都没下载**。
       *
       * ⇒ 量出来的是「缓存命中」不是「首屏」，性能预算就成了假绿。
       * ⇒ 每本之前都 `Network.clearBrowserCache` + `Storage.clearDataForOrigin`
       *   （后者清 SW 注册，否则它会继续在 fetch 事件里返回缓存）。
       *
       * 这样量到的才是**冷启动**——也就是新访客第一次打开的那一次。
       */
      await send('Network.clearBrowserCache', {});
      await send('Storage.clearDataForOrigin', {
        origin: `http://127.0.0.1:${port}`,
        storageTypes: 'all',
      }).catch(() => { /* 老版本 Chrome 没有这个域，忽略 */ });

      net.clear();
      const t0 = Date.now();
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?book=${b.slug}` });
      let booted = false;
      for (let i = 0; i < 200; i++) {
        const r = await send('Runtime.evaluate', {
          expression: '!!(window.__ba && window.__ba.state && window.__ba.state.book && window.__ba.state.chart)',
          returnByValue: true,
        });
        if (r.result?.result?.value) { booted = true; break; }
        await new Promise((r) => setTimeout(r, 100));
      }
      const wall = Date.now() - t0;
      const r = await send('Runtime.evaluate', { expression: 'window.__baPerf||{}', returnByValue: true });
      const perf = r.result?.result?.value || {};
      /* 等文案包预取**真正完成**，再量完整传输量。
       *
       * ⚠⚠⚠ v0.200：**连着错了三版**，都表现为「同一台机器两次跑出两个数」
       *   （罪与罚 JSON 在 9.9 KB 与 77.9 KB 之间跳）。错法各不相同：
       *
       * ① `setTimeout(3000)` —— 赌预取 3 秒内跑完。
       * ② 轮询「网络静默」 —— **"没有变化"不等于"已经完成"**：
       *    页面刚起来时网络本来就很安静，于是连测三次就退出，量到的是只下图包的半个首屏。
       * ③ 等「text.json 出现在网络记录里」—— 方向对了，但仍不可靠：
       *    `responseReceived` 只说明**响应头到了**，`loadingFinished` 才说明**body 收完**，
       *    而统计读的是 `bytes`（来自 `loadingFinished`）⇒ 看到响应就退出会**少算**。
       *
       * ⇒ 正确口径：**问应用自己**。`app.js` 的 `attachText()` 会把
       *   `state.textStatus = { slug, status: 'done' }` 置上 —— 那是"文案包已解析完成"
       *   的**权威信号**，不必从网络侧猜。
       *   （`requestIdleCallback` 让它几时才发不可预测，所以任何"等固定时长"都是赌。）
       *   上限 20s 兜底；超时**按未完成报出来**，不静默放过 —— 宁可吵，不可假绿。 */
      const textUrl = `${b.slug}.text.json`;
      let textDone = false;
      for (let i = 0; i < 50 && !textDone; i++) {
        const rr = await send('Runtime.evaluate', {
          expression: 'window.__ba?.state?.textStatus?.status === "done"',
          returnByValue: true,
        });
        textDone = rr.result?.result?.value === true;
        if (!textDone) await new Promise((r) => setTimeout(r, 400));
      }
      /* ⚠⚠ v0.205.1：textDone 之后必须**再沉降一会**再读行。
       *
       * 现场：`textStatus==='done'` 一变真，上面的轮询立刻退出 —— 但 CDP 是
       * **异步事件流**，这个响应的 `Network.loadingFinished` 可能还在 socket 上飞。
       * 小包（百年孤独 text 27.6KB）赶得上，大包（三国 text gzip 后 154KB）稳定赶不上
       * ⇒ 三国的 text.json 与 annotations 每次都记成 **0 字节**（jsonBytes 84.9 而非 ~250）。
       * 这就是 jsonBytes “跨机器跳”的最后一变：不是 SW、不是机器，是**读完就走**。
       * 400ms 是本地及 CI 实测都够的余量（ events 延迟是毫秒级）。 */
      await new Promise((r) => setTimeout(r, 400));
      const sawText = [...net.values()].some((v) => v?.url?.includes(textUrl));
      if (!textDone || !sawText) {
        console.error(`  ⚠ ${b.slug}：等了 20 秒文案包仍未确认完成`
          + `（state.textStatus=${textDone ? 'done' : '非 done'}、网络记录里${sawText ? '有' : '没有'} ${textUrl}）`
          + ' —— 首屏传输量会偏小。这不是"数据变小了"，是没量全。');
      }
      const rows = [...net.values()].filter((v) => v && v.bytes);
      const total = rows.reduce((s, v) => s + v.bytes, 0);
      const jsonBytes = rows.filter((v) => /\.json/.test(v.url || ''))
        .reduce((s, v) => s + v.bytes, 0);
      out[b.slug] = {
        booted, wallMs: wall,
        fetchParseMs: perf.fetchParse ?? null,
        chartMs: perf.chart ?? null,
        totalBytes: total, jsonBytes,
      };
    }
    ws.close();
    return out;
  } finally {
    proc.kill();
    srv.close();
    /* ⚠ 必须先 kill 浏览器再删 profile —— 反过来就是 EBUSY（本轮踩过）。 */
    await new Promise((r) => setTimeout(r, 400));
    releaseProfile(profile);
  }
}

/**
 * ⚠ **`booted: false` 时那些耗时数字全是废的** —— 页面没起来时循环跑满 20 秒就退出，
 *   `wallMs` 会是个很大的数，`fetchParseMs` / `chartMs` 是 undefined。
 *   那种情况**不能 bless**：会把"页面加载失败"记成"基线 20000ms"，
 *   之后所有真实运行都会显得"变快了"。必须在这里挡住。
 */
function assertBooted(measured) {
  const dead = BOOKS.filter((b) => !measured[b.slug]?.booted);
  if (!dead.length) return true;
  console.error(`\n✗ 有 ${dead.length} 本书在测量窗口内没加载起来：`
    + dead.map((b) => b.slug).join('、'));
  console.error('  ⇒ 它们的耗时数字没有意义，不能 bless（否则会把"加载失败"记成基线）。');
  console.error('  ⇒ 常见原因：数据文件语法坏了 / app.js 抛异常 / CDP 连上了但页面在报错的错误页上。');
  return false;
}

/* ───────────────────────── 跑 ───────────────────────── */

let measured;
try {
  measured = await measure();
} catch (e) {
  console.error(`\n✗ 实测失败：${e.message}`);
  console.error('  浏览器起不来时不要静默跳过 —— 那会让这条守卫变成装饰品');
  console.error('  （同款教训：test/browser.mjs 曾经找不到浏览器就 exit 0，在 CI 上「绿」着不跑）。');
  process.exit(2);
}

console.log('  实测（到图可交互 / 网络传输走gzip）：');
for (const b of BOOKS) {
  const m = measured[b.slug];
  const kb = (m.jsonBytes / 1024).toFixed(1);
  const tot = (m.totalBytes / 1024).toFixed(0);
  console.log(`  ${b.slug.padEnd(28)} ${String(m.wallMs).padStart(5)}ms   `
    + `（自报 fetch+parse ${m.fetchParseMs ?? '?'}ms / chart ${m.chartMs ?? '?'}ms）`
    + `   JSON ${kb} KB / 总 ${tot} KB`);
  if (!m.booted) fail++;
}

if (BLESS) {
  if (!assertBooted(measured)) process.exit(1);
  const doc = {
    _note: '首屏性能基线。改法：node test/perf-budget.mjs --bless',
    _judge: `相对基线 >${WARN}× 提示、>${FAIL}× 报红（机器差异约 ±5%）`,
    _blessedAt: new Date().toISOString().slice(0, 10),
    books: measured,
  };
  /* 把确定性期望也写进基线：字节判据改用「实测 vs 期望」，不跨机器比基线。 */
  for (const b of BOOKS) {
    const gz = (rel) => { try { return gzipSync(fs.readFileSync(path.join(ROOT, rel)), { level: 9 }).length; } catch { return 0; } };
    if (doc.books[b.slug]) doc.books[b.slug].jsonExpect = gz('data/books.json')
      + gz(`data/${b.slug}.graph.json`) + gz(`data/${b.slug}.text.json`) + gz(`data/annotations/${b.slug}.json`);
  }
  fs.writeFileSync(BASELINE, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log(`\n✓ 已写入基线 ${path.relative(ROOT, BASELINE)}`);
  console.log('  ⚠ bless 会把当前值当"正常" —— 别为了让 CI 变绿而 bless 一个已经慢了的版本。');
  process.exit(0);
}

/* ── 比对基线 ── */
if (!assertBooted(measured)) process.exit(1);
if (!fs.existsSync(BASELINE)) {
  console.error(`\n✗ 没有基线文件 ${path.relative(ROOT, BASELINE)}`);
  console.error('  先量一次并落盘：node test/perf-budget.mjs --bless');
  process.exit(1);
}
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

console.log(`\n  判定：相对基线 >${WARN}× 提示、>${FAIL}× 报红`);
console.log(`  基线记录于 ${base._blessedAt}\n`);

for (const b of BOOKS) {
  const now = measured[b.slug];
  const was = base.books?.[b.slug];
  if (!was || typeof was.wallMs !== 'number') {
    ok(false, `${b.slug}：基线里没有这本书（加书后要重新 --bless）`);
    continue;
  }
  const ratio = now.wallMs / was.wallMs;
  const label = `${b.label}`;
  if (ratio > FAIL) {
    ok(false, `${label}：首屏 ${now.wallMs}ms，是基线 ${was.wallMs}ms 的 ${ratio.toFixed(2)}×`
      + `（阈值 ${FAIL}×）`);
    console.error(`      基线 ${was.wallMs}ms → 现在 ${now.wallMs}ms（chart ${was.chartMs ?? '?'} → ${now.chartMs ?? '?'}ms）`);
    console.error('      ⚠ 这个幅度不可能是机器差异。真变慢了才 bless，别拿 bless 消警告。');
  } else if (ratio > WARN) {
    pass++;
    console.log(`  ⚠ ${label}：${ratio.toFixed(2)}×（${now.wallMs}ms vs 基线 ${was.wallMs}ms）—— 未达红线，但值得看一眼`);
  } else {
    ok(true, `${label}：${now.wallMs}ms（基线 ${was.wallMs}ms 的 ${ratio.toFixed(2)}×）`);
  }

  /* ── ② 传输量：判据从「跨机器比基线」改成「实测 vs 本地确定性期望」（v0.205.1） ──
   *
   * ⚠ 为什么改：字节判定原来拿 `measured.jsonBytes` 比 `baseline.jsonBytes`（±50% 红）。
   *   实测证明**两个方向都会假红**，因为量到“哪些 .json 走了网络”本身随环境跳：
   *   · v0.200 注释记过前三变（固定 3 秒 / 等网络静默 / 看 responseReceived）；
   *   · v0.205.1 第四变：同一份数据，百年孤独的 jsonBytes 在**基线上 53.5 KB、
   *   本机另一次 39.3 KB、CI 11.8 KB** 之间跳（三国/罪与罚则三次都稳）——
   *     CI 上 11.8 KB ≈ gzip(graph) 单包，即 text 包的传输没落进计数窗口。
   *   `textStatus==='done'` 只能证明“解析完了”，证明不了“走了网络”
   *   （SW 缓存命中时没有网络记录可计）—— ±50% 的带宽容不下这个跳动。
   *
   * ⇒ 新判据：**期望值现算** —— 用服务器同一份参数（`gzipSync(level 9)`）把
   *   `<slug>.graph.json + <slug>.text.json` 压一遍，那是“冷启动访客理论上要传的字节”，
   *   完全确定性（同文件同参数同结果，无机器差异）。
   *   · `measured > 期望×1.5` ⇒ 红：浏览器传得比文件重（重复请求 / 没走 gzip），真问题；
   *   · `measured < 期望×0.5` ⇒ **只警告不红**：没量全（SW 缓存/计时窗口），
   *     是测量问题不是数据问题 ——  Fan the 噪声史后这一侧再也不许红。
   *   · “数据变胖”另有两道确定性哨兵：`make-slim-packs --check`（包与源同步）
   *     + git diff 肉眼；墙钟时间那条（倍数判据）仍对严重变胖敏感。
   *
   * ⚠ `totalBytes`（骨架）三本书历代实测都稳（非 JSON 部分恒为 vendor 骨架），
   *   保持原有绝对阈值不变。 */
  const expectJson = (b) => {
    try {
      /* 首屏 json 抓取全集（以页面实际请求为准，debug 实测）：
       *   books.json + <slug>.graph.json + <slug>.text.json + annotations/<slug>.json
       * ⚠ v0.205.1 补上后两个：text 走空闲预取、annotations 随书加载，
       *   漏了它们期望值就偏小，判据会连续的"实测大于期望"假红。 */
      const gz = (rel) => gzipSync(fs.readFileSync(path.join(ROOT, rel)), { level: 9 }).length;
      return gz('data/books.json')
        + gz(`data/${b.slug}.graph.json`)
        + gz(`data/${b.slug}.text.json`)
        + gz(`data/annotations/${b.slug}.json`);
    } catch { return null; }
  };
  const jNow = now.jsonBytes ?? 0;
  const jExpect = expectJson(b);
  const jWasExpect = typeof was.jsonExpect === 'number' ? was.jsonExpect : null;
  if (jExpect && jWasExpect) {
    const pct = jNow / jExpect;
    const kb = (n) => (n / 1024).toFixed(1);
    if (pct > 1.5) {
      ok(false, `${label}：实测 JSON ${kb(jNow)} KB，是确定性期望（服务器同参 gzip 后的首屏 json）${kb(jExpect)} KB 的 ${pct.toFixed(2)}×`);
      console.error('      ⇒ 浏览器传得比文件重：重复请求 / 没走 gzip / 页面里又拉了一遍数据。');
    } else if (pct < 0.5) {
      console.log(`  ⚠ ${label}：实测 JSON ${kb(jNow)} KB 不到期望 ${kb(jExpect)} KB 的一半（${pct.toFixed(2)}×）`
        + ' —— 没量全（首包 late 请求记 0 字节，见上方噪声史）。只警告不红：测量问题不是数据问题。');
    } else {
      ok(true, `${label}：实测 JSON ${kb(jNow)} KB（期望 ${kb(jExpect)} KB 的 ${pct.toFixed(2)}×）`);
    }
  } else if (jExpect) {
    console.log(`  ℹ ${label}：实测 JSON ${(jNow / 1024).toFixed(1)} KB，期望 ${(jExpect / 1024).toFixed(1)} KB`
      + '（基线里没有 jsonExpect，跑一次 --bless 补上后才做这条判定）');
  }
  const tNow = now.totalBytes ?? 0;
  const tWas = was.totalBytes;
  if (typeof tWas === 'number' && tWas > 0 && jExpect) {
    /* json 分量测量不稳（见上方噪声史），两侧都换成确定性期望再比 ——
     * 否则哪次多量到一卷 text（三国 gzip 后 154 KB），总量就平白跳 1.3× 压阈值。 */
    const cleanNow = tNow - jNow + jExpect;
    const cleanWas = tWas - (was.jsonBytes ?? 0) + (jWasExpect ?? jExpect);
    const pct = cleanNow / cleanWas;
    if (pct > 1.25) {
      ok(false, `${label}：首屏总传输 ${(tNow / 1024).toFixed(0)} KB，`
        + `是基线 ${(tWas / 1024).toFixed(0)} KB 的 ${pct.toFixed(2)}×（骨架阈值 1.25×）`);
      console.error('      ⇒ 骨架变大了：多半是往 index.html / editor.html 里新加了 <script> 或 <link>。');
      console.error('        ⚠ 注意 SW 预缓存改动也会动这个数（v0.199 删了 402 KB 的 pdf 库）——');
      console.error('          那是有意的减小，bless 即可；别为了让门禁绿而把库加回来。');
    } else {
      ok(true, `${label}：首屏总传输 ${(cleanNow / 1024).toFixed(0)} KB（基线 ${(cleanWas / 1024).toFixed(0)} KB，json 已归一）`);
    }
  }
}

console.log('\n' + '═'.repeat(56));
if (fail) {
  console.log(`✗ ${pass} 项通过、${fail} 项超出预算（首屏变慢不会被放过 —— 这正是这条守卫存在的理由）`);
  process.exit(1);
}
console.log(`✓ ${pass} 项在预算内`);
/* ⚠ 必须**显式退出**：上面把清扫放进了 `setImmediate` 后台跑，
 *   而清扫会拉 PowerShell 查进程表（实测能跑 22 分钟）——
 *   Node 的事件循环会等它做完，于是这个守卫测完也不退出
 *   （本轮实测：判定本身 18 秒，进程挂到 3 分钟仍未结束）。
 *   ⇒ 测完立刻 exit，不等后台清扫。清扫是可选项，不是本守卫的职责。 */
process.exit(0);