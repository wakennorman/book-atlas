/**
 * 「文件在你磁盘上，但不在仓库里」必须报红 —— v0.165.2 新增
 *
 * ## 为什么要有它（一次真实翻车）
 *
 * v0.165 我新建了 `test/_browser.mjs`（19 个浏览器测试都要 import 它），
 * 本地一切正常、门禁 55 步全绿。推上 GitHub 后 CI 连挂两次。
 *
 * 真相是：**那个文件从来没进过仓库。**
 * `.gitignore` 第 31 行写着 `_*.mjs`（本意是"别把本地临时脚本发上去"），
 * 于是 `test/_browser.mjs` 被静默排除，`git add -A` 也不捡它。
 * CI 上 `ERR_MODULE_NOT_FOUND: Cannot find module '.../test/_browser.mjs'`。
 *
 * 同目录下 `test/_profile-guard.mjs` 命中的是同一条规则，却一直好好地躺着 ——
 * **只因它在 `_*.mjs` 这条规则被加进 `.gitignore` 之前就已提交**，
 * 而 git 对"已跟踪文件"不再应用 ignore 规则。
 * 同一个目录、同一种命名，一个能活一个不能活，**光看本地目录看不出区别**。
 *
 * 所以这类错误有两重隐蔽：
 *   ① 本地永远全绿（文件就在磁盘上）；
 *   ② 同类文件可能有的活有的死，掩盖问题。
 *
 * ## 判据（两条）
 *
 * ① **引用完整性**：`check.yml` 里出现的每一个 `*.mjs` 路径，磁盘上必须真的存在。
 *    —— 这条能**当场**抓住本次故障：`check.yml` 的语法检查清单里就写着 `test/_browser.mjs`。
 *
 * ② **入库完整性**：`test/` 与 `scripts/` 下磁盘上存在的每个 `*.mjs`，
 *    必须要么已被 git 跟踪，要么命中 `.gitignore` 里**明写的临时文件例外名单**。
 *    —— 这条能在**提交前**抓住，不用等 CI。
 *
 * 例外名单只有 `_tmp-*` / `_y*.mjs`（`audit-against-text.mjs` 的中间产物）两条，
 * 是白名单而不是"凡被忽略就放过" —— 否则这条守卫等于没有。
 *
 * ## 边界
 *
 * · 不在 git 仓库里（拿到的源码包）⇒ 全部跳过并说明，不硬报红。
 * · 只看 `test/` 与 `scripts/`：这两个目录放的是要长期维护的代码，
 *   不是临时产物；根目录的 `_*.mjs` 才是本地脚本，仍然照旧忽略。
 *
 * 用法：node test/helpers-tracked.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YML = path.join(ROOT, '.github', 'workflows', 'check.yml');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

/* ---------- 前提：有 git 仓库吗 ---------- */
let tracked = null;
try {
  const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  tracked = new Set(out.split(/\r?\n/).filter(Boolean).map((p) => p.replace(/\\/g, '/')));
} catch (e) {
  console.log('  (跳过) 不在 git 仓库里，无法核对入库状态 —— 本守卫只在 clone 出来的仓库里有意义');
  process.exit(0);
}

/* ---------- ① check.yml 引用的 .mjs 必须在磁盘上存在 ---------- */
console.log('① check.yml 引用的脚本必须真的在磁盘上');
{
  const yml = fs.readFileSync(YML, 'utf8');
  // 只取非注释行（注释里提到脚本名不算引用）
  const refs = new Set();
  for (const line of yml.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    for (const m of line.matchAll(/(?:scripts|test|tools|miniprogram\/(?:utils|test))\/[\w.-]+\.mjs/g)) {
      refs.add(m[0]);
    }
  }
  ok(refs.size > 10, `从 check.yml 的非注释行解析出 ${refs.size} 个脚本引用`);
  const missing = [...refs].filter((r) => !fs.existsSync(path.join(ROOT, r))).sort();
  ok(missing.length === 0,
    missing.length ? `${missing.length} 个被引用但磁盘上不存在：${missing.join('、')}` : `${refs.size} 个引用全部存在`);
  if (missing.length) {
    console.error('      ⇒ 这正是 v0.165 的翻车现场：文件只存在于本地，gitignore 把它挡在了仓库外。');
  }
}

/* ---------- ② test/ 与 scripts/ 下的 .mjs 必须已入库（或命中例外名单）---------- */
console.log('\n② test/ 与 scripts/ 下的 .mjs 必须已入库（否则本地绿、CI 崩）');
{
  // 白名单：check.yml 的注释里已说明用途的临时产物
  const ALLOW = [/^_tmp-/, /^_y.*\.mjs$/];
  const dirs = ['test', 'scripts'];
  let examined = 0;
  const orphans = [];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.mjs')) continue;
      examined++;
      const rel = `${d}/${f}`;
      if (tracked.has(rel)) continue;
      if (ALLOW.some((re) => re.test(f))) continue;
      orphans.push(rel);
    }
  }
  ok(orphans.length === 0,
    orphans.length
      ? `${orphans.length} 个 .mjs 在磁盘上却没入库：${orphans.join('、')}`
      : `${examined} 个 .mjs 全部已入库（或命中临时文件例外名单）`);
  if (orphans.length) {
    console.error('      ⇒ 改个不以 `_` 开头的名字（`_*.mjs` 被 .gitignore 挡着），别去给 .gitignore 开口子。');
    console.error('      ⇒ 例外：临时脚本可命名 `_tmp-*` 或 `_y*.mjs`。');
  }
}

console.log(fail ? `\n✗ ${fail} 条不符预期（本地绿、CI 崩的经典来源）` : `\n✓ 全部通过（${pass} 条）`);
process.exit(fail ? 1 : 0);