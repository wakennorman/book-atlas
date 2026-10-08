#!/usr/bin/env node
/**
 * 「改了前端资源，却忘了 bump `sw.js` 的 `CACHE`」的检查。
 *
 * ## 为什么还需要它（`check-version.mjs` 不够）
 * `check-version.mjs` 查的是**一致性**：各处 `?v=NN` 与 `CACHE` 是否**彼此相等**。
 * 它查不出**该 bump 而没 bump** —— 因为「全都没动」也是一致的，检查会通过。
 *
 * 实测踩过（v0.145 发现）：`js/` 从 v0.131 到 v0.142 **至少 9 轮**改过前端资源，
 * 而 `sw.js` 的 `CACHE = 'bookatlas-v99'` 一直没动。
 * 这正是 v0.69–v0.71 出过、`check-version.mjs` 当初要防的那件事，换了个入口复发。
 *
 * ## 后果（按 sw.js 的真实策略说，不夸大）
 * sw.js 的 fetch 对 HTML/JS/CSS 是**网络优先**（ed16c38 起）⇒ **在线访客仍能拿到新资源**。
 * 所以 v0.69–v0.71 那句「老访客一直跑旧代码」在当前策略下**已不再成立**（当时是缓存优先）。
 * 不 bump 的真实代价是**缓存卫生与离线**：
 *   · SW 不重装 ⇒ `CACHE` 名不变 ⇒ `activate` 里「删掉非当前 CACHE」那句永远不执行 ⇒ 旧缓存只进不出；
 *   · `SHELL` 预缓存清单停在旧版本（写死 `./js/app.js?v=145` 这类带旧版本号的 URL）
 *     ⇒ 离线时这些新 URL 只能靠「运行时网络优先顺手缓存」兜底；没兜到的就 miss，
 *        并回退去 `caches.match('./index.html')`（把 HTML 当资源返回）⇒ 离线体验退化甚至白屏。
 * 项目约定（README「改前端资源后要同步三处」）要求同步 bump，这道检查就是守它。
 *
 * ## 判据（只用 git，不靠猜）
 *   base = **最后一次改动 `CACHE` 的提交**（`git log -G` 找）
 *   ① 若 `sw.js` 相对 base **变过**（工作树也算）⇒ SW 会重装 ⇒ 通过
 *      —— 这一步同时兜住本地节奏：正常是「改前端 → bump → 跑门禁 → 提交」，
 *         此刻 base 还停在上一版，但 bump 已经在工作树里了，不该报红。
 *   ② 否则，若 base 以来**任一被预缓存的资源**变过 ⇒ 就是忘了 bump ⇒ exit 1
 *
 * 用「工作树」而不是「`base..HEAD` 两个提交」：本项目**发布是 GitHub Pages 从 `main`
 * 直推**（README「部署与发布」），CI 并不拦发布 ⇒ 只比提交的话，本地 `npm run gate`
 * 会在提交前**假绿**，等你推上去其实已经上线了。比工作树才能在最前面拦住。
 *
 * ## 宁可跳过，不可误报
 * 拿不到 git 历史（浅克隆 / 不是仓库 / 找不到 base）⇒ 打印「跳过」并 **exit 0**。
 * 门禁里一条会误报的检查，最后一定会被 `|| true` 吞掉（本项目有过先例）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* 允许测试把 ROOT 指到一个临时仓库（test/version-bump-guard.mjs 用）。 */
const ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SW = path.join(ROOT, 'sw.js');

const git = (args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;   // 不是仓库 / 没装 git ⇒ null
  return (r.stdout || '').trim();
};

const skip = (why) => { console.log(`· 跳过版本 bump 检查：${why}`); process.exit(0); };

/* ---- 要盯哪些文件：从 `sw.js` 的 `SHELL`（预缓存清单）推导，而不是手抄 ----
 * 为什么盯 SHELL：**只有被预缓存的资源，改了才需要 bump**。
 * 没被预缓存的（test/、scripts/、miniprogram/、shared/…）改了不影响 SW。
 * 反过来，手抄一份清单一定会漏 —— 本项目 `altNames` 白名单漏字段、`make-anno-digest`
 * 漏进 CI 都是这么栽的。所以清单**从源（SHELL）读**。
 *
 * 排除项：
 *   · `./`        —— 目录本身，没有字节
 *   · `./data/*`  —— 走 stale-while-revalidate，会自己更新，不需要 bump
 *   （`sw.js` 自己不在 SHELL 里；它字节一变浏览器就重装，天然自触发。） */
const FALLBACK = ['index.html', 'editor.html', 'manifest.webmanifest', 'css/', 'js/', 'vendor/', 'assets/'];
function shellFiles() {
  let text;
  try { text = fs.readFileSync(SW, 'utf8'); } catch { return null; }
  // 数组在 sw.js 里是「行首 `];` 收尾」的普通字面量，注释里没有 `]`。
  const m = /const SHELL\s*=\s*\[([\s\S]*?)\n\];/.exec(text);
  if (!m) return null;
  const urls = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
  const out = urls
    .map((u) => u.replace(/\?.*$/, '').replace(/^\.\//, ''))
    .filter((u) => u && u !== '.' && !u.startsWith('data/'));
  return [...new Set(out)];
}
const shell = shellFiles();
/* 解析不出来 ⇒ 退回手写清单（宁可少盯几个，也不能盯错）。
 * 打印一行说明，免得「静默退化成手抄清单」这件事本身又变成一个看不见的洞。 */
const FRONTEND = (shell && shell.length >= 5) ? shell : FALLBACK;
if (!(shell && shell.length >= 5)) {
  console.log('· 注：没能从 sw.js 的 SHELL 推出预缓存清单，退回手写清单。');
}

/* ---- base = 最后一次改动 `CACHE` 的提交 ----
 * ⚠ 必须写 `[0-9]` 而不是 `\d`：git 的 `-G` 走 **POSIX 正则**，不认 Perl 的 `\d`
 *   （BRE 里 `\d` 被当作字面 `d`）⇒ `bookatlas-v\d` 实际只匹配 `bookatlas-vd`，
 *   永远找不到 base ⇒ 本检查**静默跳过、等于没生效**。自测时踩过。 */
const base = git(['log', '-1', '--format=%H', '-G', 'bookatlas-v[0-9]', '--', 'sw.js']);
if (!base) skip('找不到改动过 CACHE 的提交');

/* ① sw.js 相对 base 变过（含工作树未提交的 bump）⇒ SW 会重装 ⇒ 通过 */
const swDiff = git(['diff', '--name-only', base, '--', 'sw.js']);
if (swDiff === null) skip('无法比较 base 与工作树（多半是浅克隆，CI 里给 checkout 加 fetch-depth: 0）');
if (swDiff !== '') {
  console.log(`✓ 版本 bump 检查通过（sw.js 相对 ${base.slice(0, 7)} 已变，SW 会重装）`);
  process.exit(0);
}

/* ② CACHE 没动 ⇒ 看 base 以来被预缓存的资源有没有变过 */
const changed = git(['diff', '--name-only', base, '--', ...FRONTEND]);
if (changed === null) skip('无法比较 base 与工作树');
if (changed === '') {
  console.log(`✓ 版本 bump 检查通过（自 ${base.slice(0, 7)} 起没改过预缓存资源）`);
  process.exit(0);
}

console.error('✗ 改了预缓存的前端资源，却没 bump `sw.js` 的 `CACHE`：');
console.error(`    base（最后一次 bump）= ${base.slice(0, 7)}`);
for (const f of changed.split('\n')) console.error('      · ' + f);
console.error('');
console.error('  后果：sw.js 字节不变 ⇒ 浏览器不重装 SW ⇒ CACHE 名与 SHELL 预缓存清单停在旧版本，');
console.error('        旧缓存也不会被清。（sw.js 对 HTML/JS/CSS 是网络优先 ⇒ 在线访客仍能拿到新资源；');
console.error('        吃亏的是离线：新 URL 不在预缓存里，miss 时会把 index.html 当资源返回。）');
console.error('  修复：node scripts/bump-version.mjs <新版本号>，并同步 package.json 的 version。');
process.exit(1);
