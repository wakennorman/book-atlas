/**
 * 单测：scripts/check-version-bump.mjs（「改了预缓存资源却没 bump CACHE」的检查）。
 *
 * ## 为什么值得单独测一条「检查脚本」
 * 这条检查本身就是为了防「判据存在但从不触发」。如果它自己**永远 exit 0**
 * （比如 `-G 'bookatlas-v\d'` 里 `\d` 被 git 当字面 `d`、永远找不到 base），
 * 那它就是又一个「看着在守、其实没守」的假门禁 —— 正是本项目反复踩的那一族。
 * ⇒ 必须有一条测试**证明它真的会报红**，否则它随时可能悄悄退化成空转。
 *
 * ## 怎么测：造一个**临时 git 仓库**，把 ROOT 指过去
 * 脚本支持 `BOOKATLAS_ROOT` 环境变量（只给测试用），所以这里能在 tmp 里
 * `git init` 一个最小仓库（sw.js + index.html + js/app.js + css + data），
 * 逐场景跑，断言退出码。全程不碰真实仓库。
 *
 * ⚠ 没装 git 就跳过（CI 的 ubuntu 与本地开发机都有；和别的测试「找不到 Edge 就跳过」一致）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-version-bump.mjs');

let pass = 0, fail = 0;
const ok = (c, m, extra) => {
  if (c) { pass++; console.log(`  ✓ ${m}`); }
  else { fail++; console.error(`  ✗ ${m}${extra !== undefined ? `  → ${extra}` : ''}`); }
};

const probe = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (probe.status !== 0) {
  /* ⚠ v0.180：别把「起不了子进程」说成「没装 git」。
   * 实测本机 `spawnSync` 对**任何**命令都返回 `status: null, error.code: 'EBUSY'`
   * （连 spawn 一个 node 自己都起不来），而 git 明明装着 —— 原文案
   * 「没装 git，跳过」会让人以为是环境缺工具，实际是**这道门禁在本机根本没执行**。
   * 两者要分开说：否则"跳过"看起来像"环境不支持"，而不是"有个洞没被守"。 */
  const why = probe.error && probe.error.code === 'EBUSY'
    ? '本机 node 起不了子进程（EBUSY）⇒ 这道门禁在本机**未执行**（CI 上会真跑）'
    : `起不了 git（${(probe.error && probe.error.code) || `status=${probe.status}`}）⇒ 未执行`;
  console.log(`· 跳过：${why}`);
  process.exit(0);
}

/* ---------- 造临时仓库 ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-vb-'));
const git = (args) => spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
const commit = (msg) => {
  git(['add', '-A']);
  const r = git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg]);
  if (r.status !== 0) throw new Error('临时仓库提交失败：' + (r.stderr || r.stdout));
};

const sw = (ver) => `/* 书脉 BookAtlas · Service Worker（离线可用） */
const CACHE = 'bookatlas-v${ver}';
const SHELL = [
  './',
  './index.html',
  './css/style.css?v=${ver}',
  './js/app.js?v=${ver}',
  './data/books.json',
];
`;
const w = (rel, text) => {
  const fp = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, text, 'utf8');
};

w('sw.js', sw(1));
w('index.html', '<script src="js/app.js?v=1"></script>');
w('js/app.js', 'export const v = 1;\n');
w('css/style.css', 'body { color: #000; }\n');
w('data/books.json', '{"books":[]}\n');

git(['init', '-q']);
git(['config', 'core.autocrlf', 'false']);
git(['config', 'user.email', 't@t']);
git(['config', 'user.name', 't']);
commit('init（v1，含 bump）');

/* ---------- 跑被测脚本 ---------- */
const run = () => {
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, BOOKATLAS_ROOT: tmp },
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
/* 期望「通过」：退出码 0 且没有 ✗ */
const expectPass = (m) => {
  const r = run();
  ok(r.code === 0 && !/✗/.test(r.out), m, `exit=${r.code}｜${r.out.trim().split('\n').pop()}`);
};
/* 期望「报红」：退出码非 0 且有 ✗ */
const expectRed = (m) => {
  const r = run();
  ok(r.code !== 0 && /✗/.test(r.out), m, `exit=${r.code}｜${r.out.trim().split('\n').pop()}`);
};

/* ---------- 场景 ---------- */
console.log('版本 bump 检查：');

/* 1) 刚 bump 完、工作树干净 ⇒ 通过（base==HEAD） */
expectPass('bump 提交后、工作树干净 ⇒ 通过');

/* 2) 改了 js/app.js 并提交，没 bump ⇒ 报红（这是 v0.131→v0.142 那个真实 bug） */
w('js/app.js', 'export const v = 2;\n');
commit('改 js/app.js（没 bump）');
expectRed('提交了 js/ 改动但没 bump ⇒ 报红');

/* 3) 补上 bump 并提交 ⇒ 通过 */
w('sw.js', sw(2));
w('index.html', '<script src="js/app.js?v=2"></script>');
commit('bump 到 v2');
expectPass('补 bump 后 ⇒ 通过');

/* 4) 改 css（也在预缓存清单里）没 bump ⇒ 报红 */
w('css/style.css', 'body { color: #111; }\n');
commit('改 css（没 bump）');
expectRed('提交了 css/ 改动但没 bump ⇒ 报红');

/* 4b) 补 bump 并提交，让仓库回到干净态（否则下面几步会继承这里的红） */
w('sw.js', sw(3));
w('index.html', '<script src="js/app.js?v=3"></script>');
commit('bump 到 v3');
expectPass('补 bump 后 ⇒ 通过');

/* 5) 改 data/（走 stale-while-revalidate，会自更新）没 bump ⇒ **不报红** */
w('data/books.json', '{"books":[{"slug":"x"}]}\n');
commit('改 data/（没 bump，本就不需要）');
expectPass('只改 data/ 没 bump ⇒ 通过（SWR 自更新，不该误报）');

/* 6) 本地节奏：工作树里改了 js + 已 bump（都还没提交）⇒ 通过（不该在提交前误报） */
w('js/app.js', 'export const v = 4;\n');
w('sw.js', sw(4));
w('index.html', '<script src="js/app.js?v=4"></script>');
expectPass('工作树里 js 与 bump 同时未提交 ⇒ 通过（本地提交前不误报）');
git(['checkout', '--', '.']);   // 还原

/* 7) 工作树里改了 js、**没** bump ⇒ 报红（发布是 Pages 直推，必须在本地就拦住） */
w('js/app.js', 'export const v = 5;\n');
expectRed('工作树里改了 js 但没 bump ⇒ 报红');
git(['checkout', '--', '.']);

/* 8) 不是 git 仓库 ⇒ 跳过、exit 0（宁可跳过不可误报） */
const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-vb-plain-'));
fs.writeFileSync(path.join(plain, 'sw.js'), sw(1), 'utf8');
const r8 = spawnSync(process.execPath, [SCRIPT], {
  cwd: plain, encoding: 'utf8', env: { ...process.env, BOOKATLAS_ROOT: plain },
});
ok(r8.status === 0 && /跳过/.test((r8.stdout || '') + (r8.stderr || '')),
  '不是 git 仓库 ⇒ 跳过且 exit 0', `exit=${r8.status}`);
fs.rmSync(plain, { recursive: true, force: true });

/* ---------- 清理 ---------- */
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${'='.repeat(40)}`);
console.log(`通过：${pass}  失败：${fail}`);
if (fail > 0) process.exit(1);
console.log('全部通过');
