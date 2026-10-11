/**
 * 单测：`scripts/lib/profile-prefixes.mjs`（Temp 临时目录前缀白名单）
 * ＋ **它与全仓 `mkdtempSync` 实际用到的前缀双向一致**。
 *
 * ## 为什么值得单独测（v0.192）
 *
 * 起因是用户报「C 盘又变红了」。查下来 Temp 里堆着 **224 个** `ba-*-<6位随机>` 目录、
 * 合计 **14.56 GB**，全是本项目浏览器测试留下的 profile。
 *
 * 根因**不是**回收逻辑坏了，而是**白名单漂了**：`test/_profile-guard.mjs` 里那份
 * `PROFILE_PREFIXES` 是手写的，后来新增的 `gen-fill` / `band-labels` / `annotations` /
 * `fullscreen` / `browser-locator` 各自 `mkdtempSync` 的前缀**从没被补进去** ⇒
 * `sweepStaleProfiles()` 一次都没回收过它们。实测泄漏量：
 * `ba-fill-` 62 个 / 7.76 GB · `ba-anno-` 82 个 / 3.10 GB · `ba-band-` 62 个 / 3.12 GB。
 *
 * ⚠ 那个文件的注释早就写着「新增脚本时把前缀加进来，否则它的泄漏没人兜底」——
 *   但**没有任何东西在守这句话**。手写清单 + 无人对拍 = 必然漂移（本仓库反复踩的同一族）。
 *   这就是本文件存在的唯一理由。
 *
 * ## 判据（**双向**，只查一半等于没查）
 *
 * | # | 判据 |
 * |---|---|
 * | P1 | 扫描器没坏：全仓抓到的 `ba-*` 前缀数 ≥ 20（数字突然变小 = 解析器坏了，不是"干净了"） |
 * | P2 | **正向**：抓到的每个前缀都被某条表项覆盖（否则**新脚本又漏了** = 这次 14.56 GB 的成因） |
 * | P3 | **反向**：每条表项都覆盖到某个抓到的前缀（否则是打字错误或脚本已删 ⇒ 表项永远不生效） |
 * | P4 | 每条表项形状是 `ba-xx-`（以 `-` 结尾、段间才用 `-`）—— 防"写成 `ba-` 就横扫一切" |
 * | P5 | `isOwnTempName` 认自己的目录、**不认** `ba-books`（原著 txt 所在）与无关名字 |
 * | P5b | `isBrowserLeftover` 认 `msedge_*` / `scoped_dir*`、**不认** `ba-*`（两张表互斥 —— 浏览器的命名空间不是我们的） |
 * | P6 | 两张表**各只有一份定义**：除 lib 外没有任何文件再声明它们 |
 * | P7 | 消费方真的用了它们（`sweepStaleProfiles` 调两个判定函数，浏览器残留有**自己那道** 24h 闸） |
 * | P8 | 两道安全闸还在（`held.has(` 的进程占用闸 ＋ `staleMs` 的 mtime 闸）—— 防"为了扫干净把闸拆了" |
 *
 * ## ⚠ 这条守卫**刻意不起子进程**
 *
 * 本机 node 起不了**任何**子进程（`spawnSync` 一律 EBUSY，v0.180 实测）。
 * 它只做静态扫描 + 纯函数调用，所以在本机和 CI 上都能真跑。
 *
 * ## ⚠ 写这条守卫时踩到的两个"自我绊倒"（保留下来当反面教材）
 *
 * ① **必须剥注释再扫**：`test/_profile-guard.mjs` 的文件头注释里**逐字**写着
 *    `mkdtempSync(os.tmpdir(), 'ba-xxx-')`，而它的正文注释里也**逐字**引用了
 *    `PROFILE_PREFIXES.some((p) => name.startsWith(p))`（那句正是它要警示的反例）。
 *    ⇒ 不剥注释的话，P2 会把 `ba-xxx-` 当成一个**漏掉的真前缀**，P7 会把**注释里的反例**
 *      当成"清扫循环里还有第二处判据"。两者都是**假红**。
 *    （`test/guard-hygiene.mjs` 早就为同一族问题剥了注释，本文件沿用它的写法。）
 * ② **待查关键词要拆开拼接**：P6 的判据本身是 `PROFILE_PREFIXES\s*=\s*\[`，如果把它
 *    原样写成正则字面量，**本文件自己**就会命中它（铁律：把待查关键词原样写进守卫源码
 *    会自我绊倒）⇒ 用 `'PROFILE_' + 'PREFIXES' + …` 拼出来，源码里不再出现连续的那串。
 *
 * 用法：node test/profile-prefix-guard.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILE_PREFIXES, isOwnTempName, BROWSER_LEFTOVERS, isBrowserLeftover } from '../scripts/lib/profile-prefixes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'scripts', 'lib', 'profile-prefixes.mjs');
const GUARD_HELPER = path.join(ROOT, 'test', '_profile-guard.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

/** 去掉 `//` 行注释与块注释 —— **判据必须看代码，不能看注释**（与 `test/guard-hygiene.mjs` 同一写法）。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

console.log('══ Temp 临时目录前缀白名单的守卫 ══\n');

/** 递归列 `.mjs`（跳过 node_modules / .git / vendor）。 */
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'vendor') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/* ── 扫描：全仓 `mkdtempSync(... os.tmpdir() ..., '<前缀>')` 里的前缀 ──
 *
 * ⚠ 不用一条大正则去啃整个调用：`path.join(os.tmpdir(), 'ba-rel-')` 里**自带括号**，
 *   `[^)]*` 会在 `os.tmpdir()` 处提前收尾 ⇒ 前缀抓不到、守卫**静默变成恒绿**。
 *   改成"从 `mkdtempSync` 往后取一段，再在里面挑以 `ba-` 开头的字符串字面量"。
 * ⚠ **先剥注释**：`test/_profile-guard.mjs` 的注释里就有一句 `mkdtempSync(os.tmpdir(), 'ba-xxx-')`
 *   当示例 ⇒ 不剥就会把 `ba-xxx-` 当成真前缀，P2 假红。
 */
const SCAN_DIRS = ['test', 'scripts', 'miniprogram'];
const found = new Map();                       // 前缀 -> [相对路径, …]
for (const dir of SCAN_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of walk(abs)) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (let i = src.indexOf('mkdtempSync'); i >= 0; i = src.indexOf('mkdtempSync', i + 1)) {
      const win = src.slice(i, i + 240);
      for (const m of win.matchAll(/['"]([^'"]+)['"]/g)) {
        if (!m[1].startsWith('ba-')) continue;
        if (!found.has(m[1])) found.set(m[1], []);
        const rel = path.relative(ROOT, f).replace(/\\/g, '/');
        if (!found.get(m[1]).includes(rel)) found.get(m[1]).push(rel);
        break;                                  // 一次 mkdtempSync 只认第一个 ba-* 字面量
      }
    }
  }
}
const prefixes = [...found.keys()].sort();

/* ── P1 扫描器没坏 ── */
ok(prefixes.length >= 20,
  `全仓抓到 ${prefixes.length} 个 Temp 前缀（应 ≥ 20）—— 数字突然变小说明扫描器坏了，不是"变干净了"`);

/* ── P2 正向：抓到的每个前缀都要被白名单覆盖 ── */
{
  const uncovered = prefixes.filter((p) => !isOwnTempName(p));
  ok(uncovered.length === 0,
    `抓到的 ${prefixes.length} 个前缀**全部**被白名单覆盖`
    + (uncovered.length
      ? ` —— 漏了 ${uncovered.length} 个：${uncovered.map((p) => `${p}（${found.get(p).join('、')}）`).join('；')}`
        + '。⚠ 漏一条 = 那个脚本的 profile 一次都不会被回收（v0.192 的 14.56 GB 就是这么来的）'
      : ''));
}

/* ── P3 反向：每条表项都要有用（否则是打字错误 / 脚本已删） ── */
{
  const dead = PROFILE_PREFIXES.filter((p) => !prefixes.some((q) => q.startsWith(p)));
  ok(dead.length === 0,
    `白名单 ${PROFILE_PREFIXES.length} 条**全部**覆盖到真实前缀`
    + (dead.length ? ` —— 这 ${dead.length} 条是死的（打字错误或脚本已删）：${dead.join('、')}` : ''));
}

/* ── P4 表项形状：必须以 `-` 结尾，且长到不会误伤 ── */
{
  const bad = PROFILE_PREFIXES.filter((p) => !/^ba-[a-z0-9]+(-[a-z0-9]+)*-$/.test(p));
  ok(bad.length === 0,
    '每条表项都是 `ba-xx-` 的形状（以 `-` 结尾）'
    + (bad.length ? ` —— 不合法：${bad.join('、')}。⚠ 少了结尾的 \`-\` 会误吞别的目录` : ''));
  const dup = PROFILE_PREFIXES.filter((p, i) => PROFILE_PREFIXES.indexOf(p) !== i);
  ok(dup.length === 0, `表里没有重复项${dup.length ? ` —— 重复：${dup.join('、')}` : ''}`);
}

/* ── P5 `isOwnTempName` 的语义（认自己的、不认别人的） ── */
{
  ok(isOwnTempName('ba-fill-QMIQmZ'), '认自己开的目录（`ba-fill-` 那类）');
  ok(isOwnTempName('ba-vb-plain-Ab12Cd'), '`ba-vb-plain-` 也被 `ba-vb-` 覆盖（多一段的写法不能漏）');
  ok(!isOwnTempName('ba-books'), '⚠ **不认** `ba-books` —— 那里面是三本书的**原著 txt**，删了要重新找');
  ok(!isOwnTempName('opencode'), '不认无关目录（`opencode`）');
  ok(!isOwnTempName('scoped_dir16044_397848572'), '不认 Edge 自己的临时目录（`scoped_dir*` 不是我们 mkdtemp 的）');
  ok(!isOwnTempName(''), '空名字不认（不崩）');
  /* ⚠ 这条是"白名单被写成 `ba-`"的兜底断言：那会横扫 Temp 下所有 `ba-*`。 */
  ok(!isOwnTempName('ba-whatever'), '⚠ 表里没有 `ba-` 这种通配项（否则会横扫 Temp 下所有 `ba-*`）');
}

/* ── P5b `isBrowserLeftover` 的语义（第二张表：浏览器自清失败的残留） ──
 *
 * v0.192 一次性清掉 `msedge_*` 1355 个 / 5.18 GB、`scoped_dir*` 74 个 / 2.14 GB ——
 * 那也是本项目测试强杀 Edge 造成的。这两张表**必须分开**：浏览器的命名空间不是我们的，
 * 混进 `PROFILE_PREFIXES` 的话，"本仓库 mkdtemp 的目录"这个语义就糊了。
 */
{
  ok(isBrowserLeftover('msedge_chrome_Unpacker_BeginUnzipping2572_1654654620'), 'P5b 认 `msedge_*`（组件解包残留，v0.192 实测 1355 个 / 5.18 GB）');
  ok(isBrowserLeftover('scoped_dir102984_1317023160'), 'P5b 认 `scoped_dir*`（扩展安装残留，v0.192 实测 74 个 / 2.14 GB）');
  ok(!isBrowserLeftover('ba-fill-QMIQmZ'), 'P5b **不认**我们自己的 profile（两张表必须互斥，不许一张表吞两张的活）');
  ok(!isBrowserLeftover('ba-books'), 'P5b 不认 `ba-books`');
  ok(!isBrowserLeftover('opencode') && !isBrowserLeftover(''), 'P5b 不认无关目录 / 空名字（不崩）');
  ok(BROWSER_LEFTOVERS.every((p) => !p.startsWith('ba-')),
    'P5b 第二张表里没有任何 `ba-` 开头的条目（那是我们的命名空间，该进第一张表）');
  ok(BROWSER_LEFTOVERS.every((p) => p.endsWith('_') || p === 'scoped_dir'),
    'P5b 每条表项形状可辨（`msedge_` / `scoped_dir`）');
}

/* ── P6 两张表都只有一份定义 ── */
{
  /* ⚠ 关键词**拆开拼接**：写成 `/PROFILE_PREFIXES\s*=\s*\[/` 的话，**本文件自己**会命中它
   *   （源码里出现了连续的那串）⇒ 守卫会报"有第二处定义"，而那第二处就是它自己。
   *   拼开之后，源码里不再有连续串，正则自然也不匹配自己。 */
  const TABLES = [
    ['PROFILE_', 'PREFIXES'],
    ['BROWSER_', 'LEFTOVERS'],
  ].map(([a, b]) => [a + b, new RegExp(`${a}${b}` + '\\s*=\\s*\\[')]);
  const offenders = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of walk(abs)) {
      if (f === LIB) continue;
      /* 剥注释：注释里提一句"表长这样"不算第二处定义。 */
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      /* 只认"声明"，不认 import / re-export：`export { X }` 是允许的。 */
      for (const [name, re] of TABLES) {
        if (re.test(src)) offenders.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}（${name}）`);
      }
    }
  }
  ok(offenders.length === 0,
    '两张表都只有 `scripts/lib/profile-prefixes.mjs` 一处定义（铁律 7：同一个定义不许抄第二份）'
    + (offenders.length ? ` —— 还有：${offenders.join('、')}` : ''));
}

/* ── P7 消费方真的用了它（防「库写了、忘了接」） ── */
{
  /* ⚠ 剥注释再判：`_profile-guard.mjs` 的注释里**逐字**引用了那句被删掉的内联判据
   *   （当反面教材），不剥的话这条会**假红** —— 而它恰恰是在检查"那句话已经不在代码里了"。 */
  const src = stripComments(fs.readFileSync(GUARD_HELPER, 'utf8'));
  /* ⚠ 同样拆开拼接，免得本文件自己命中。 */
  const SOME_RE = new RegExp('PROFILE_' + 'PREFIXES' + '\\.some\\(');
  ok(/from\s+'\.\.\/scripts\/lib\/profile-prefixes\.mjs'/.test(src),
    '`test/_profile-guard.mjs` 从 lib import 了这份表（否则它就是死的）');
  ok(/isOwnTempName\s*\(/.test(src),
    '清扫循环真的调了 `isOwnTempName`（不是自己再抄一份 `startsWith` 判据）');
  ok(!SOME_RE.test(src),
    '清扫循环里**没有**第二处内联判据（`.some(` 那种）—— 判据只许一处定义');
  ok(/isBrowserLeftover\s*\(/.test(src),
    '清扫循环也调了 `isBrowserLeftover`（浏览器残留同样要兜底，否则 C 盘还会再红一次）');
  ok(/leftoverMs/.test(src),
    '浏览器残留有**自己那道** mtime 闸（`leftoverMs`，24 小时）—— 不能混用 profile 的 30 分钟闸');
}

/* ── P8 两道安全闸还在 ── */
{
  const src = fs.readFileSync(GUARD_HELPER, 'utf8');
  ok(/held\.has\(/.test(src),
    '① 进程占用闸还在（并发会话正在用的 profile 绝不动）—— 删掉它就会误删别人正在用的 profile');
  ok(/staleMs/.test(src),
    '② mtime 闸还在（只收 > 30 分钟没写过的）—— 删掉它会把刚建的 profile 一起删');
  ok(/宁可漏删/.test(src) || /不可误删/.test(src),
    '文件头仍写明"宁可漏删，不可误删"这条取舍（改判据的人得先看到它）');
}

console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过`}`);
process.exit(fail ? 1 : 0);
