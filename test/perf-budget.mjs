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

function serve() {
  return new Promise((res) => {
    const s = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); return rq.end(); }
      const body = fs.readFileSync(f);
      const hdrs = { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' };
      /* JSON 走 gzip，模拟真实静态托管（GitHub Pages / Nginx 默认都开）。
       * ⚠ 不开就量的是"本地磁盘读JSON"，比真实网络快一个量级，测出来没意义。 */
      if (/\.json$/.test(f) && body.length > 4096) {
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
    const WS = (await import('ws')).default;
    const ws = new WS(await cdpUrl(cdpPort), { perMessageDeflate: false });
    await new Promise((r) => ws.on('open', r));
    let seq = 0;
    const pending = new Map();
    const net = new Map();
    ws.on('message', (m) => {
      const d = JSON.parse(m);
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
      if (d.method === 'Network.responseReceived') {
        net.set(d.params.requestId, { url: d.params.response.url, bytes: 0 });
      }
      if (d.method === 'Network.loadingFinished') {
        const e = net.get(d.params.requestId);
        if (e) e.bytes = d.params.encodedDataLength;
      }
    });
    const send = (method, params = {}) => new Promise((rs) => {
      const i = ++seq; pending.set(i, rs);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    await send('Network.enable', {});
    await send('Page.enable', {});
    await send('Runtime.enable', {});

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
      /* 等后台预取（text / annotations）跑完，再量完整传输量。 */
      await new Promise((r) => setTimeout(r, 3000));
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
  console.log(`  ${b.slug.padEnd(28)} ${String(m.wallMs).padStart(5)}ms   `
    + `（自报 fetch+parse ${m.fetchParseMs ?? '?'}ms / chart ${m.chartMs ?? '?'}ms）`
    + `   JSON ${kb} KB`);
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