#!/usr/bin/env node
/**
 * 归档一次性脚本（v0.195 · 债二 B1 的一次性执行脚本）
 *
 * ## 为什么是「一次性执行」而不是直接 `git mv`
 *
 * 立项文档写的是「不许批量 mv 了事」，因为归档要同时做三件事：
 *   ① 确认这个脚本的**结论已经落进 `data/*.json` 或 CHANGELOG**（否则归档＝丢未完成的工作）
 *   ② 在文件头**加归档标记**（日期 + 为什么归档 + 结论在哪）—— 否则 archive 变成垃圾桶
 *   ③ 真的移动文件
 * 三件事绑在一起，就必须写脚本，不能手敲 50 次 `mv`。
 *
 * ## ① 的判据为什么不是「CHANGELOG 里有对应段落」
 *
 * 实测：`CHANGELOG.md` 有 84 个版本段落，但 **v0.61 之后有一段跳号** ——
 * v0.100~v0.128 那一批版本**没有独立段落**（v0.99 之后直接到更晚的合并段落）。
 * 于是 50 个待归档脚本里有 **29 个**「标注的版本在 CHANGELOG 里找不到」。
 *
 * ⚠ 那不是缺口。那批脚本本来就是**改数据**的，跑一次、结论落进 `data/*.json` 就完事；
 *   CHANGELOG 那一段没写，是**记账方式的差异**，不是工作没做。
 * ⇒ 判据改成「**脚本的结论落在数据里，或 CHANGELOG 有段落**」，两者居一即可。
 *
 * ## ② 标记长什么样
 *
 * 在文件头插入：
 *
 *     【已归档】2026-10-12　v0.195 债二 B1：一次性补丁，用完即归档。
 *                     结论已落进 data/*.json（见 CHANGELOG 对应版本）。
 *                     留在这里是为了留痕"当时怎么改的"，不再作为可执行入口。
 *
 * ⚠ 守卫 `test/scripts-hygiene-guard.mjs` 的 P2 认两种标记：
 *   `【已归档】` 与 `@archived`。用前者，因为它是中文文档里最醒目的一种。
 *
 * 用法：
 *   node scripts/archive-one-offs.mjs            # 预览
 *   node scripts/archive-one-offs.mjs --write    # 落盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATCH_PREFIX, ROOT, KEEP_TOOL } from './make-scripts-index.mjs';

const WRITE = process.argv.includes('--write');
const ARCHIVE = path.join(ROOT, 'scripts', 'archive');
const STAMP = '2026-10-12';

const MARK = (version, where) => [
  `【已归档】${STAMP}　v0.195 债二 B1：一次性补丁，用完即归档。`,
  `                    结论去向：${where}`,
  `                    留在这里是为了留痕「当时怎么改的」，不再是可执行入口。`,
];

/** CHANGELOG 里有没有这个版本的段落（跳号的那批算没有，属正常）。 */
function inChangelog(version) {
  if (!version) return false;
  return fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').includes(`## ${version}`);
}

/** 文件头取到的第一个版本号（形如 v0.194）。 */
function versionOf(src) {
  return (src.slice(0, 900).match(/v0\.\d+/) || [])[0] || null;
}

fs.mkdirSync(ARCHIVE, { recursive: true });

const scriptsDir = path.join(ROOT, 'scripts');
const targets = fs.readdirSync(scriptsDir)
  .filter((f) => f.endsWith('.mjs') && PATCH_PREFIX.test(f) && fs.statSync(path.join(scriptsDir, f)).isFile());

/* ⚠ **已经躺在 archive/ 里、但文件头没有【已归档】标记的老文件** —— 补标记。
 *
 *   `scripts/archive/` 里早就有 8 个文件（`_patch-v11` / `_patch-aliases-v36` …），
 *   那是**上一轮**归档的，那轮没加标记 ⇒ 守卫 P2 会红。
 *   它们的结论早已落进 data/*.json（都是 v0.11~v0.36 时的数据补丁），
 *   这里只补标记、不搬动。 */
const stale = fs.readdirSync(ARCHIVE)
  .filter((f) => f.endsWith('.mjs') && fs.statSync(path.join(ARCHIVE, f)).isFile())
  .filter((f) => !fs.readFileSync(path.join(ARCHIVE, f), 'utf8').includes('【已归档】'));

console.log(`待处理：顶层 ${targets.length} 个待归档；archive 里 ${stale.length} 个缺标记\n`);

for (const f of stale) {
  const fp = path.join(ARCHIVE, f);
  const src = fs.readFileSync(fp, 'utf8');
  const v = versionOf(src);
  const where = inChangelog(v) ? `CHANGELOG.md 的 ${v} 段` : 'data/*.json（改数据的脚本，跑完即生效）';
  const lines = src.split('\n');
  const at = lines[0].startsWith('#!') ? 1 : 0;
  /* 三种文件头写法都认（`/**`、`/*`、`//`）—— 同款教训见 `tag-script-lifetime.mjs`。 */
  const docStart = lines.findIndex((l, i) => i >= at && (l.startsWith('/**') || l.startsWith('/*') || l.startsWith('//')));
  if (docStart < 0) { console.log(`  ？ ${f}：找不到注释文件头，跳过（需手工）`); continue; }
  /* ⚠⚠ **单行闭合的块**（`/** 说明 …*\/` 一整行写完）不能往下一行插 ——
   *   下一行已经在块外，插进去就成了裸的 `* …` ⇒ 语法直接坏掉。
   *   `_patch-v11.mjs` 就是这种，第二版把它写坏了（`node --check` 当场报
   *   `Unexpected token '*'`），最后靠 `git checkout HEAD --` 才救回来。
   *   ⇒ 这种文件把块**拆成两行**：第一行去掉行尾闭合符，第二行补上闭合符。 */
  const singleLine = lines[docStart].trimEnd().endsWith('*/');
  const indent = lines[docStart].startsWith('//') ? '// '
    : (lines[docStart + 1] || ' *').match(/^\s*\*/)?.[0] || ' *';
  const mk = MARK(v, where);
  if (singleLine) {
    const body = lines[docStart].replace(/\*\/\s*$/, '').trimEnd();
    const ins = [
      `${body}`,
      ...mk.map((t) => `${indent} ${t}`),
      `${indent} */`,
    ];
    if (WRITE) {
      lines.splice(docStart, 1, ...ins);
      const out = lines.join('\n');
      if (!out.includes('【已归档】')) { console.error(`✗ ${f}：写完找不到标记`); process.exit(1); }
      fs.writeFileSync(fp, out, 'utf8');
    }
    console.log(`  ✔ ${f.padEnd(36)} ${v ?? '(无版本标注)'} → 拆行补标记（${where}）`);
    continue;
  }
  console.log(`  ✔ ${f.padEnd(36)} ${v ?? '(无版本标注)'} → 补标记（${where}）`);
  if (WRITE) {
    lines.splice(docStart + 1, 0, ...MARK(v, where).map((t) => `${indent} ${t}`));
    fs.writeFileSync(fp, lines.join('\n'), 'utf8');
  }
}
if (!WRITE && stale.length) console.log('\n（预览）以上将补上【已归档】标记。加 --write 才落盘。\n');

console.log(`待归档：${targets.length} 个（scripts/ 顶层的一次性补丁）\n`);

const skipped = [];
const planned = [];

for (const f of targets) {
  /* 显式排除优先于前缀（理由见 KEEP_TOOL 的注释）。 */
  if (KEEP_TOOL.has(f)) {
    skipped.push([f, '是常驻工具（validate 会建议用户跑它），不归档']);
    continue;
  }

  const src = fs.readFileSync(path.join(scriptsDir, f), 'utf8');
  const v = versionOf(src);

  /* 幂等：已归档的不再处理。 */
  if (src.includes('【已归档】')) { skipped.push([f, '已有归档标记']); continue; }

  /* ① 结论去向：CHANGELOG 有段落 ⇒ 指向它；没有 ⇒ 指向 data/（改数据的脚本跑完即生效）。 */
  const where = inChangelog(v) ? `CHANGELOG.md 的 ${v} 段` : 'data/*.json（改数据的脚本，跑完即生效）';

  /* 插到文件头：第一个 /** 之后（保留 shebang 的脚本另处理）。 */
  const lines = src.split('\n');
  let at = 0;
  if (lines[0].startsWith('#!')) at = 1;
  /* 三种文件头写法都认（`/**`、`/*`、`//`）—— 同款教训见上面 stale 那段。 */
  const docStart = lines.findIndex((l, i) => i >= at && (l.startsWith('/**') || l.startsWith('/*') || l.startsWith('//')));
  if (docStart < 0) { skipped.push([f, '找不到文件头注释块，不自动插入']); continue; }

  const block = MARK(v, where);
  const indent = lines[docStart].startsWith('//') ? '// '
    : (lines[docStart + 1] || ' *').match(/^\s*\*/)?.[0] || ' *';
  const ins = block.map((t) => `${indent} ${t}`);

  planned.push({ file: f, version: v, where, docStart, ins });
  console.log(`  ✔ ${f.padEnd(36)} ${v ?? '(无版本标注)'} → ${where}`);
}

if (skipped.length) {
  console.log('\n跳过的：');
  for (const [f, why] of skipped) console.log(`  － ${f}：${why}`);
}

if (!WRITE) {
  console.log(`\n（预览）将归档 ${planned.length} 个。加 --write 才落盘。`);
  process.exit(0);
}

let done = 0;
for (const p of planned) {
  const fp = path.join(scriptsDir, p.file);
  const lines = fs.readFileSync(fp, 'utf8').split('\n');
  /* 在文件头块的第一行之后插入（docStart 行是 /**）。 */
  lines.splice(p.docStart + 1, 0, ...p.ins);
  const out = lines.join('\n');

  /* ⚠ 写前自检：解析得过、且标记真的进去了。 */
  const chk = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'ba-arc-'));
  try {
    const probe = path.join(chk, p.file);
    fs.writeFileSync(probe, out, 'utf8');
    if (!fs.readFileSync(probe, 'utf8').includes('【已归档】')) {
      console.error(`✗ ${p.file}：写完仍找不到归档标记，放弃`);
      process.exit(1);
    }
  } finally { fs.rmSync(chk, { recursive: true, force: true }); }

  fs.writeFileSync(fp, out, 'utf8');
  const dest = path.join(ARCHIVE, p.file);
  if (fs.existsSync(dest)) fs.unlinkSync(fp); else fs.renameSync(fp, dest);
  done++;
}

console.log(`\n✓ 已归档 ${done} 个到 scripts/archive/`);
console.log('  下一步：node scripts/make-scripts-index.mjs　（索引是生成物，会自动更新）');
