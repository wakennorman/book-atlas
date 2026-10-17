#!/usr/bin/env node
/**
 * 【长期】发布门禁每轮都跑　（v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定）
 * 校验 sw.js 的预缓存清单与 data/books.json 一致（发布门禁的一步）。
 *
 * 为什么需要它
 * ------------
 * 网站会持续加书，而 sw.js 的 SHELL 数组里是**硬编码**每个 `.graph.json` 的路径。
 * 每加一本书就得手工往里加一行，忘了不会有任何报错 —— 直到某天想做离线可用才发现少一本。
 *
 * 这不是曾经发生过的 v0.69–v0.71 那种事故（那次的症状是"老访客一直跑旧代码"），
 * 严重程度低得多：/data/ 走的是 stale-while-revalidate，漏了只是首次访问多一次
 * 网络请求，不会白屏、不会拿到错数据。但"悄悄不一致"本身就是 bug 的温床，
 * 而且这个检查写起来只有三十行。
 *
 * 它检查两件事：
 *   1. books.json 里每本书的 graphFile 都在 sw.js 的 SHELL 里（漏了要报）
 *   2. sw.js 的 SHELL 里没有已从 books.json 移除的 .graph.json（残留要报，会白占缓存）
 *
 * ⚠ v0.199 补第三条（data 之外的整个 SHELL）：SHELL 里每个条目都必须是**页面真的会请求的
 * 那个精确 URL**。原先只查 `./data/`，vendor/ css/ js/ assets/ 全无人过问，于是：
 *   · vendor/pdf.min.js + pdf.worker.min.js 预缓存了 402 KB（gzip）却**一次都没被命中** ——
 *     SHELL 写的是不带 query 的 './vendor/pdf.min.js'，编辑器页面请求的是
 *     './vendor/pdf.min.js?v=197'，Cache Storage 按完整 URL 建 key ⇒ 两条不同的记录。
 *   · assets/icon-512.png、assets/favicon-32x32.png 无人引用（纯白占）。
 * **"key 对不上"比"没人引用"更隐蔽**：它看起来像一条正常的预缓存条目，读起来也合理，
 * 但它既不省任何一次请求、又没实现离线兜底 —— 是一笔**两头落空**的开销。
 * 判据见下面 P3/P4，两条都带可执行的有效性自测（守卫必须能因真原因变红）。
 *
 * 用法：node scripts/check-sw-precache.mjs
 * 通过时静默退出 0；不一致时打印差异并 exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swRaw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const books = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'books.json'), 'utf8')).books || [];

/* ⚠ 必须**先剥掉注释**再提取 SHELL 条目。
 * sw.js 的文件头与 SHELL 旁边全是注释，而注释里为了说明问题会**引用具体的 URL**
 * （例如「页面请求的是 './vendor/pdf.min.js?v=197'」）—— 不剥注释就会把注释里
 * 提到的 URL 当成 SHELL 条目，于是：
 *   · 数据里凭空多出条目 / 删掉的条目删不掉（注释里还留着）
 *   · 判据开始检查自己写在注释里的说明文字 ⇒ 报红，却与真实预缓存无关。
 * 这与 v0.196「目录里写行号 = 假坐标」同族：**判据读的东西必须是它声称在读的那部分**。 */
const sw = swRaw
  .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
  .replace(/^\s*\/\/.*$/gm, '');     // 行注释

// sw.js 的 SHELL 里所有 ./data/... 条目
const cached = new Set(
  [...sw.matchAll(/'(\.\/data\/[^']+)'/g)].map((m) => m[1]),
);

const problems = [];
const wanted = new Set();

for (const b of books) {
  if (!b.graphFile) continue;
  // books.json 里写的是 "data/xxx.graph.json"，sw.js 里是 "./data/xxx.graph.json"
  const url = './' + b.graphFile.replace(/^\.\//, '');
  wanted.add(url);
  if (!cached.has(url)) {
    problems.push(`sw.js 的 SHELL 里缺 ${url}（《${b.title}》的图包）。加书时忘了同步，离线首访要多等一次网络。`);
  }
  // 有 graphFile 就该有 textFile，否则文案永远加载不出来
  if (!b.textFile) {
    problems.push(`books.json 里《${b.title}》有 graphFile 但没有 textFile —— 人物描述/结局会是空的`);
  }
}

for (const url of cached) {
  if (url.endsWith('.json') && !url.endsWith('books.json') && !wanted.has(url)) {
    problems.push(`sw.js 的 SHELL 里有多余的 ${url}（books.json 里已没有这本书）。书删掉后它会一直白占缓存。`);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * P3 / P4：SHELL 里 **非 data** 的每一条，都必须命中页面真实的请求。
 *
 * ⚠ 为什么必须按**精确 URL**（含 ?v=）比对，而不是按去掉 query 的路径：
 *   Cache Storage 的 key 是完整 URL。'./js/app.js' 与 './js/app.js?v=197' 是两条记录，
 *   预缓存了后者而页面请求前者（或反过来）⇒ 预缓存的那份**永远不会被命中**。
 *   去掉 query 比对会把这种"两头落空"判成通过 —— 那正是本条要抓的东西。
 * ───────────────────────────────────────────────────────────────────────── */
const shellAll = [...sw.matchAll(/'(\.\/[^']+)'/g)].map((m) => m[1]);

/** 页面与脚本真实请求的精确 URL 集合（保留 query）。 */
function collectRequested() {
  const out = new Set();
  const scan = (file) => {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) return;
    const text = fs.readFileSync(p, 'utf8');
    // HTML 的 src= / href=
    for (const m of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const u = m[1];
      if (/^(https?:|data:|#|mailto:|\/\/)/.test(u)) continue;
      out.add('./' + u.replace(/^\.\//, ''));
    }
    // JSON 的 "src": "..." —— manifest.webmanifest 的 icons 用这个写法，
    // 只认 HTML 写法会把 PWA 安装图标（assets/icon-512.png）判成白占。
    for (const m of text.matchAll(/"(?:src|href)"\s*:\s*"([^"]+)"/g)) {
      const u = m[1];
      if (/^(https?:|data:|#)/.test(u)) continue;
      out.add('./' + u.replace(/^\.\//, ''));
    }
    // JS 里的动态引用（worker / import()）
    for (const m of text.matchAll(/'(vendor\/[^']+\.js(?:\?v=\d+)?)'/g)) {
      out.add('./' + m[1]);
    }
  };
  for (const f of ['index.html', 'js/app.js']) scan(f);
  // manifest.webmanifest 也会让浏览器去取图标（assets/icon-512.png 只被它引用）——
  // 漏掉它会把「PWA 安装图标」判成白占。
  scan('manifest.webmanifest');
  return out;
}

/** P3/P4 的判据本体 —— 抽成函数，好让下面的有效性自测**跑同一份逻辑**。
 *  （自测里复制一份判据 = 有两份会各自漂移的真相；v0.197 就在自检上栽过。） */
export function shellOrphanProblems(shellList, requestedSet) {
  const out = [];
  for (const url of shellList) {
    if (url.includes('/data/')) continue;         // data 由上面两条判据管
    if (url === './') continue;                   // 目录根，浏览器请求的就是它
    if (requestedSet.has(url)) continue;

    // 没精确命中 ⇒ 找出同一路径下页面实际请求的是哪个 query 版本
    const bare = url.split('?')[0];
    const siblings = [...requestedSet].filter((r) => r.split('?')[0] === bare);
    if (siblings.length) {
      out.push(
        `sw.js 的 SHELL 里 ${url} 与页面请求的 ${siblings.join(' / ')} **不是同一个 URL**。` +
        `Cache Storage 按完整 URL 建 key ⇒ 这一条永远不会被命中，` +
        `它既没省掉任何一次请求、也没实现离线兜底。把 SHELL 里的 query 改成页面实际用的那个，` +
        `或确认它确实不需要预缓存就删掉。`
      );
    } else {
      out.push(
        `sw.js 的 SHELL 里 ${url} 没有任何页面引用它（index 的 src/href、js 里的动态引用都没有）。` +
        `删掉它，或在页面里真的用它。`
      );
    }
  }
  return out;
}

problems.push(...shellOrphanProblems(shellAll, collectRequested()));

if (problems.length) {
  console.error('sw.js 预缓存清单与 data/books.json 不一致：');
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('\n修复：往 sw.js 的 SHELL 数组里加上/删掉对应条目（改完记得跑 node scripts/bump-version.mjs <版本>）');
  process.exit(1);
}

/* ─────────────────────────────────────────────────────────────────────────
 * 有效性自测：一个不能因真原因变红的守卫 = 装饰品。
 * 下面每条都用**真实的坏样本**跑上面那份判据，期望它必须报错。
 * ⚠ 口径：只测"会红"，不测"该绿时绿"（后者由每次真实运行承担）。
 * ───────────────────────────────────────────────────────────────────────── */
if (process.env.SW_PRECACHE_SELFTEST === '1') {
  const S = new Set([
    './index.html', './vendor/echarts.min.js', './vendor/fflate.min.js',
    './js/app.js?v=197', './data/books.json',
    './data/three-kingdoms.graph.json',
  ]);
  const cases = [
    ['干净样本不报', S, 0],
    // ↓ v0.199 真实存在过的那条：预缓存不带 query、页面请求带 query ⇒ 永远不命中
    ['key 对不上（pdf.min.js 那个）',
      new Set([...S, './vendor/pdf.min.js']), 1],
    ['key 对不上（worker 那个）',
      new Set([...S, './vendor/pdf.worker.min.js']), 1],
    ['纯白占（无人引用）',
      new Set([...S, './assets/favicon-32x32.png']), 1],
    // ↓ 反向自检：判据不能"见谁都报"，否则就是只会红不会绿
    ['data 条目不归 P3/P4 管（应放行）',
      new Set([...S, './data/never-heard-of-it.graph.json']), 0],
  ];
  let bad = 0;
  for (const [name, shell, expect] of cases) {
    const got = shellOrphanProblems(shell, S).length;
    const ok = got === expect;
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${name}（期望 ${expect} 条，实得 ${got} 条）`);
  }
  process.exit(bad ? 1 : 0);
}

console.log(`✓ sw.js 预缓存与 books.json 一致（${wanted.size} 本书的图包）`);