/**
 * 「守卫卫生」—— 对 `test/*-guard.mjs` 这一族**自己**的类级不变量。
 *
 * ## 为什么需要它（v0.180）
 *
 * 本项目反复踩「看着在守、其实没守」的假门禁（v0.145 / v0.146 / v0.154 / v0.156 / v0.160~163）。
 * 其中一族的根因是**守卫的写法**，而不是判据：
 *
 *   守卫原先统一用 `spawnSync(process.execPath, [SCRIPT]).status` 断言退出码，
 *   可**本机 node 起不了任何子进程**（实测：`spawnSync('git'|'node'|process.execPath, …)`
 *   一律 `status === null, error.code === 'EBUSY'`）⇒ `null === 0` 与 `null === 1` **全为假**
 *   ⇒ 那 5 个守卫在本机**每条用例都红**（`✗ 14 条不符合预期`…），**一条都没测到**。
 *   守卫自己成了假门禁 —— 而且症状是"红"，比假绿更难发现是**环境**问题。
 *
 * v0.180 把那 5 个守卫改成**直接 import 判据函数**（断言 `problems.length`），本机首次真跑。
 * 本文件把那次的结论**钉成不变量**，防止以后新写的守卫又退回起子进程的写法。
 *
 * ## 判据
 *
 *   H1  守卫里**不得**出现子进程（`child_process` / `spawnSync(` / `execSync(` …）——
 *       **先剥注释**（守卫的文件头本来就在讲"别用 spawnSync"，不剥会被自己的注释绊倒，
 *       这个坑 v0.180 当场踩过一次）。
 *   H2  守卫必须 import 至少一个 `../scripts/…` 模块（证明它测的是**真判据**）。
 *   H3  被 import 的那个脚本必须**导出函数**（否则守卫没法"直接调判据"）。
 *   H4  `scripts/check-*.mjs` 若有入口判断，必须是 `import.meta.url === pathToFileURL(…)`，
 *       **不得**写成 `endsWith(process.argv[1])`（本仓库目录名带空格 ⇒ 恒不相等 ⇒ 主流程一次都不跑）。
 *   H5  `scripts/check-*.mjs` 的入口块必须①**调用它自己导出的那个函数**、②`process.exit(1)` ——
 *       防"判据导出了、CLI 却调别的 / 只打印不报红"。
 *   H6  每个守卫都必须登记进 `.github/workflows/check.yml`（**剥注释后**匹配 ——
 *       否则光出现在注释里也算"登记了"）。
 *   H7  每个 `scripts/check-*.mjs` 同理必须登记进 check.yml。
 *
 * ## 豁免（**必须打印出来** —— 不打印"跳过了什么"，报告就等于装饰品）
 *
 *   见下面 `EXEMPT`，两条各有理由。
 *
 * 用法：node test/guard-hygiene.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST = path.join(ROOT, 'test');
const SCRIPTS = path.join(ROOT, 'scripts');
const YML = path.join(ROOT, '.github', 'workflows', 'check.yml');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

/** 去掉 `//` 行注释与块注释 —— **判据必须看代码，不能看注释**（v0.180 当场踩过）。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** check.yml 的**有效行**（剥掉注释行与空行）。 */
function ymlCode() {
  return fs.readFileSync(YML, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

/* ── 豁免：文件 → 理由（理由会打印出来）── */
const EXEMPT = new Map([
  ['_profile-guard.mjs',
    '不是用例入口，是被多个测试 import 的**辅助库**（临时浏览器 profile 回收）；'
    + '文件名里的 guard 只是巧合。它按设计要读进程表 ⇒ 必须 spawn。'],
  ['version-bump-guard.mjs',
    '要 `git init` / `git commit` / 读 git 历史 ⇒ **本质上必须有子进程**。'
    + '本机 spawnSync 一律 EBUSY，所以它在本地走"跳过"分支（CI 上真跑）。'],
]);

const guards = fs.readdirSync(TEST).filter((f) => f.endsWith('-guard.mjs')).sort();
const yml = ymlCode();

console.log('══ test/*-guard.mjs 的类级不变量 ══\n');
console.log(`  · 找到 ${guards.length} 个守卫文件；豁免 ${EXEMPT.size} 个（理由如下）`);
for (const [f, why] of EXEMPT) console.log(`      - ${f}：${why}`);
console.log('');

/* ── H1 / H2 / H3 / H6：逐个守卫 ── */
const SUBPROC = [
  ['child_process', /child_process/],
  ['spawnSync(', /\bspawnSync\s*\(/],
  ['spawn(', /\bspawn\s*\(/],
  ['execSync(', /\bexecSync\s*\(/],
  ['execFileSync(', /\bexecFileSync\s*\(/],
  ['execFile(', /\bexecFile\s*\(/],
];

console.log('▶ H1 守卫不得起子进程（剥注释后）');
for (const f of guards) {
  if (EXEMPT.has(f)) continue;
  const code = stripComments(fs.readFileSync(path.join(TEST, f), 'utf8'));
  const hit = SUBPROC.find(([, re]) => re.test(code));
  ok(!hit, `${f}${hit ? ` 命中「${hit[0]}」⇒ 本机 EBUSY 会让它每条用例都红` : ''}`);
}

console.log('\n▶ H2 / H3 守卫必须 import 真判据，且那个脚本必须导出函数');
for (const f of guards) {
  if (EXEMPT.has(f)) continue;
  const code = stripComments(fs.readFileSync(path.join(TEST, f), 'utf8'));
  const specs = [
    ...[...code.matchAll(/from\s+['"]([^'"]*scripts\/[^'"]+)['"]/g)].map((m) => m[1]),
    ...[...code.matchAll(/import\s*\(\s*['"]([^'"]*scripts\/[^'"]+)['"]/g)].map((m) => m[1]),
  ];
  ok(specs.length > 0, `${f} import 了 scripts/ 下的模块${specs.length ? `（${specs.join(', ')}）` : ' —— 一个都没有'}`);
  if (!specs.length) continue;
  for (const s of specs) {
    const target = path.resolve(TEST, s.split('?')[0]);
    if (!fs.existsSync(target)) { ok(false, `${f} 引的 ${s} 不存在`); continue; }
    const t = stripComments(fs.readFileSync(target, 'utf8'));
    const names = [...t.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]);
    ok(names.length > 0, `${path.basename(target)} 导出了函数${names.length ? `（${names.join(', ')}）` : ' —— 没有 ⇒ 守卫没法直接调判据'}`);
  }
}

console.log('\n▶ H6 每个守卫都要登记进 check.yml（剥注释后）');
for (const f of guards) {
  if (EXEMPT.has(f)) continue;
  ok(yml.includes(f), `${f}${yml.includes(f) ? '' : ' 没登记进 check.yml ⇒ 它永远不会被跑'}`);
}

/* ── H4 / H5 / H7：逐个 check 脚本 ── */
const checks = fs.readdirSync(SCRIPTS).filter((f) => /^check-.*\.mjs$/.test(f)).sort();
const withEntry = [];
for (const f of checks) {
  const code = stripComments(fs.readFileSync(path.join(SCRIPTS, f), 'utf8'));
  if (/process\.argv\[1\]/.test(code)) withEntry.push([f, code]);
}

console.log(`\n▶ H4 入口判断必须是 pathToFileURL 形式（有入口判断的 ${withEntry.length} 个）`);
for (const [f, code] of withEntry) {
  const bad = /endsWith\s*\(\s*process\.argv/.test(code);
  const good = /import\.meta\.url\s*===\s*pathToFileURL\(/.test(code);
  ok(!bad && good, `${f}${bad ? ' 用了 endsWith(process.argv[1]) ⇒ 恒不相等、主流程一次都不跑' : good ? '' : ' 入口判断既不是 endsWith 也不是 pathToFileURL —— 写法不认识'}`);
}

console.log('\n▶ H5 入口块必须调自己导出的函数、且能报红');
for (const [f, code] of withEntry) {
  const names = [...code.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]);
  const called = names.filter((n) => new RegExp(`\\b${n}\\s*\\(`).test(code));
  ok(called.length > 0, `${f} 入口块调用了自己导出的函数${called.length ? `（${called.join(', ')}）` : ' —— 一个都没调'}`);
  ok(/process\.exit\(1\)/.test(code), `${f} 有 process.exit(1)（只打印不报红 = 假门禁）`);
}

console.log('\n▶ H7 每个 check 脚本都要登记进 check.yml（剥注释后）');
for (const f of checks) {
  ok(yml.includes(f), `${f}${yml.includes(f) ? '' : ' 没登记进 check.yml ⇒ 它永远不会被跑'}`);
}

console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过`}`);
process.exit(fail ? 1 : 0);
