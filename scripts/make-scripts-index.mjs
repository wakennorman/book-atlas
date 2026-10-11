#!/usr/bin/env node
/**
 * 【长期】发布门禁每轮都跑　（v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定）
 * 生成 `scripts/README.md`（`scripts/` 的索引）。
 *
 *   node scripts/make-scripts-index.mjs          # 写
 *   node scripts/make-scripts-index.mjs --check  # 只对拍，不写（CI 用）
 *
 * ## 为什么要有这个索引（v0.189）
 *
 * `scripts/` 现在有近百个 `.mjs`，它们**不是一类东西**，混在一起看会做出两个相反的误判：
 *
 * ① **把一次性补丁当成死代码删掉**。而它们是**证据链**的一部分：
 *    数据里某个值"是哪一轮、依据哪句原文改的"，只有补丁脚本里写着。
 *    ⇒ 本轮的任务就是"给 scripts/ 建索引（**不删**）"，索引必须把这件事说清楚。
 *
 * ② **把从没被引用过的脚本当成在用**。于是改了数据却没人跑它 ——
 *    和 v0.188 那条"死清单"、v0.183 那个"没人 import 的库"是同一族的病。
 *
 * ## 为什么不手写
 *
 * 手写一张 90+ 行的文件表，**必然漂**，而且漂了没人知道（本仓库已经因为"手抄第二份定义"
 * 吃过五次）。所以照 `make-slim-packs.mjs` 的老规矩：**生成 + `--check` 对拍**，
 * 再由 `test/scripts-index-guard.mjs` 保证 `--check` 真的会红。
 *
 * ## 分类判据（机械可判，别凭印象）
 *
 * | 类别 | 怎么认 |
 * |---|---|
 * | 库 | 在 `scripts/lib/` 下 |
 * | 门禁 | 出现在 `check.yml` 的 `run: node scripts/<名字>` 里 |
 * | 一次性补丁 | 名字以 `fix-`/`add-`/`purge-`/`strip-`/`sync-`/`tag-`/`merge-`/`_` 开头，且不是门禁 |
 * | 工具 | 其余 |
 *
 * 「一句话」取自**各文件自己的文件头**（第一条含 ≥4 个汉字的注释行）——
 * 不在本脚本里再抄一遍，也就不存在"索引和脚本说的不一样"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/** 「什么是一次性补丁」的**唯一**判据。
 * ⚠ v0.195 起 `export`：守卫 `test/scripts-hygiene-guard.mjs` 要用同一份，
 *   抄第二份的话改了这边忘了那边，两边会对同一批脚本给出不同结论
 *   （判据漂移是本项目反复踩的族病）。 */
export const PATCH_PREFIX = /^(fix-|add-|purge-|strip-|sync-|tag-|merge-|_)/;

/**
 * ⚠ **例外名单**：名字命中 `PATCH_PREFIX`、但其实是长期工具/维护脚本的。
 *
 * 为什么需要它：前缀只是**命名习惯**，不是事实。同一个前缀下混着三类东西：
 *   · 真正的一次性补丁（该归档）
 *   · 常驻工具（`merge-duplicate-relations` —— `validate.mjs` 会建议用户跑它）
 *   · 维护脚本（`tag-script-lifetime` / `archive-one-offs` —— 用来维持规范的那几个）
 * 后两类一旦被归档，规范就**没法再被维持** —— 而守卫自己也会先被自己的守卫咬。
 *
 * ⚠ v0.195：这是**唯一来源**。守卫 `test/scripts-hygiene-guard.mjs`
 *   与 `scripts/archive-one-offs.mjs` 都 import 它，不再各抄一份 ——
 *   抄三份的后果是「改了这边忘了那边」，而三边都会报告自己是对的。
 */
export const KEEP_TOOL = new Set([
  'merge-duplicate-relations.mjs',   // 常驻：validate 报「关系重复」时建议用户跑它
  'tag-script-lifetime.mjs',         // 维护：给脚本补生命周期声明（P3 靠它）
  'archive-one-offs.mjs',            // 维护：归档动作本身（一次性执行）
  'add-app-partitions.mjs',          // 维护：生成 app.js 分区目录，**改 app.js 就要重跑它**
]);

/* 从文件头取"一句话"：第一条含 ≥4 个汉字的注释行
 * （跳过 shebang / 空行 / 代码围栏 / 注释结束标记）。
 * ⚠ 别在这里把注释结束标记原样写出来 —— 它会**提前闭合块注释**，
 *   后面整段代码被吞进模板字符串，报错却指向一个完全无辜的行（本轮当场踩到）。 */
export function firstLineOf(src) {
  const head = String(src || '').slice(0, 4000);
  const end = head.indexOf('*/');
  const block = end >= 0 ? head.slice(0, end) : head;
  for (const raw of block.split(/\r?\n/)) {
    /* ⚠ 行首要一起剥掉 `/*` / `/**` / `//` / `*` —— 只剥 `//` 和 `*` 的话，
     *   单行块注释 `/* xxx */` 的 `/*` 会原样留在索引里（生成出来才发现）。 */
    const t = raw.replace(/^\s*(?:\/\/|\/\*\*?|\*)?\s*/, '').replace(/\*\/\s*$/, '').trim();
    if (!t) continue;
    if (/^#!/.test(t)) continue;
    if (/^```/.test(t)) continue;
    if ((t.match(/[\u4e00-\u9fa5]/g) || []).length < 4) continue;
    const s = t.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
    return s.length > 88 ? `${s.slice(0, 88)}…` : s;
  }
  return '';
}

/** 扫一遍仓库，把"谁在用"的四类证据收齐（全部机械判定）。 */
export function collectUsage(root = ROOT) {
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'check.yml'), 'utf8');
  const ci = new Map();          // 名字 → CI 里的完整命令
  const mentioned = new Set();   // check.yml 里出现过（含 `node --check` 名单）
  for (const line of yml.split(/\r?\n/)) {
    for (const m of line.matchAll(/scripts\/([A-Za-z0-9_-]+\.mjs)/g)) mentioned.add(m[1]);
    const rm = /^\s*(?:-\s*)?run:\s*node\s+scripts\/([A-Za-z0-9_-]+\.mjs)(.*)$/.exec(line);
    if (rm) ci.set(rm[1], `node scripts/${rm[1]}${rm[2].replace(/\s+#.*$/, '').trimEnd()}`);
  }
  const importedBy = new Map();  // 名字 → 引用它的文件（相对路径）
  for (const dir of ['scripts', 'scripts/lib', 'test']) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.mjs')) continue;
      const src = fs.readFileSync(path.join(abs, f), 'utf8');
      for (const m of src.matchAll(/from\s+'[^']*\/([A-Za-z0-9_-]+\.mjs)'/g)) {
        if (!importedBy.has(m[1])) importedBy.set(m[1], []);
        importedBy.get(m[1]).push(`${dir}/${f}`);
      }
    }
  }
  const docs = new Set();
  const docsDir = path.join(root, 'docs');
  const docFiles = [
    ...(fs.existsSync(docsDir) ? fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).map((f) => path.join('docs', f)) : []),
    'README.md',
  ];
  for (const rel of docFiles) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/([A-Za-z0-9_-]+\.mjs)/g)) docs.add(m[1]);
  }
  return { ci, mentioned, importedBy, docs };
}

/** 渲染整份索引（**纯函数**：只读传入的 root 下的文件，不写任何东西）。 */
export function renderIndex(root = ROOT) {
  const scriptsDir = path.join(root, 'scripts');
  const { ci, mentioned, importedBy, docs } = collectUsage(root);

  const rows = [];
  for (const name of fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.mjs')).sort()) {
    const src = fs.readFileSync(path.join(scriptsDir, name), 'utf8');
    rows.push({ name, inLib: false, one: firstLineOf(src) });
  }
  const libDir = path.join(scriptsDir, 'lib');
  const libs = fs.existsSync(libDir)
    ? fs.readdirSync(libDir).filter((f) => f.endsWith('.mjs')).sort()
      .map((name) => ({ name, inLib: true, one: firstLineOf(fs.readFileSync(path.join(libDir, name), 'utf8')) }))
    : [];
  const archive = fs.existsSync(path.join(scriptsDir, 'archive'))
    ? fs.readdirSync(path.join(scriptsDir, 'archive')).filter((f) => f.endsWith('.mjs')).sort()
    : [];

  const usageOf = (name) => {
    const marks = [];
    if (ci.has(name)) marks.push('CI');
    else if (mentioned.has(name)) marks.push('提及');
    if (importedBy.has(name)) marks.push('import');
    if (docs.has(name)) marks.push('文档');
    return marks.length ? marks.join(' · ') : '—';
  };
  const classify = (r) => {
    if (r.inLib) return '库';
    if (ci.has(r.name)) return '门禁';
    if (KEEP_TOOL.has(r.name)) return '工具';       // ⚠ 例外优先于前缀，理由见 KEEP_TOOL 注释
    if (PATCH_PREFIX.test(r.name)) return '一次性补丁';
    return '工具';
  };
  const all = [...rows, ...libs].map((r) => ({ ...r, cat: classify(r), usage: usageOf(r.name) }));

  const ORDER = ['门禁', '库', '工具', '一次性补丁'];
  const byCat = new Map(ORDER.map((c) => [c, all.filter((r) => r.cat === c)]));
  /* ⚠ 「没人引用」的判据是 **不在 CI ＋ 没被 import ＋ 文档里没提**，
   *   「check.yml 里被提到过」**不算** —— 那个名单里混着 `node --check` 的文件列表与注释，
   *   拿它当"在用"会把问题掩盖掉（第一版就是这么写的，于是 46 个只报出 1 个）。 */
  const orphanAll = all.filter((r) => !r.inLib && !ci.has(r.name) && !importedBy.has(r.name) && !docs.has(r.name));
  const orphanPatch = orphanAll.filter((r) => PATCH_PREFIX.test(r.name) && !KEEP_TOOL.has(r.name));
  const orphanOdd = orphanAll.filter((r) => !PATCH_PREFIX.test(r.name));

  const L = [];
  L.push('# `scripts/` 索引');
  L.push('');
  L.push('> **本文件由 `node scripts/make-scripts-index.mjs` 生成**（加 `--check` 只对拍、不写）。');
  L.push('> 别手改 —— 手改会被门禁 `test/scripts-index-guard.mjs` 打回。');
  L.push('');
  L.push('## 为什么要有它');
  L.push('');
  L.push(`\`scripts/\` 现在有 ${all.length} 个 \`.mjs\`（另加 \`scripts/archive/\` ${archive.length} 个）。`);
  L.push('它们**不是一类东西**，混在一起看会做出两个**相反**的误判：');
  L.push('');
  L.push('* **把一次性补丁当成死代码删掉**。可它们是**证据链**的一部分：');
  L.push('  数据里某个值"是哪一轮、依据哪句原文改的"，只有补丁脚本里写着。');
  L.push('  ⇒ **不删**（已归档的在 `scripts/archive/`）。');
  L.push('* **把从没被引用过的脚本当成在用**。于是改了数据却没人跑它 ——');
  L.push('  和"写了没人 import 的库""建了没人读的清单"是同一族的病。');
  L.push('');
  L.push('分类判据（机械可判，本文件就是按它生成的）：');
  L.push('');
  L.push('| 类别 | 怎么认 |');
  L.push('|---|---|');
  L.push('| 库 | 在 `scripts/lib/` 下 |');
  L.push('| 门禁 | 出现在 `check.yml` 的 `run: node scripts/<名字>` 里 |');
  L.push('| 一次性补丁 | 名字以 `fix-` / `add-` / `purge-` / `strip-` / `sync-` / `tag-` / `merge-` / `_` 开头，且不是门禁，且不在 `KEEP_TOOL` 里 |');
  L.push('| 工具 | 其余 |');
  L.push('');
  L.push('⚠ **`KEEP_TOOL` 是例外名单**（v0.195）：前缀只是命名习惯，不是事实。');
  L.push('`merge-duplicate-relations.mjs` 命中 `merge-`，但 `validate.mjs` 会**建议用户跑它** ⇒ 归档它等于删掉一个出口；');
  L.push('`tag-script-lifetime.mjs` / `archive-one-offs.mjs` 是**用来维持规范的那几个脚本**（P3 靠它们才过得去）。');
  L.push('⇒ 凡是「用来维持规范」的脚本都会被自己的守卫先咬到，这是**自指陷阱**，必须显式豁免。');
  L.push('');
  L.push('## 写新脚本时（v0.195 起，守卫 `test/scripts-hygiene-guard.mjs` 会查）');
  L.push('');
  L.push('1. **文件头必须写明「一次性」还是「长期」**（P3）。分类靠猜 ⇒ 猜错就出事，');
  L.push('   v0.195 就差点把一个常驻工具归档掉。');
  L.push('2. 一次性补丁**跑完就归档**（P1）：');
  L.push('   ```bash');
  L.push('   node scripts/archive-one-offs.mjs --write');
  L.push('   ```');
  L.push('   它会加【已归档】标记（含「结论去哪了」）并搬进 `scripts/archive/`。');
  L.push('   ⚠ 归档前要确认两件事：结论已落进 `data/*.json` 或 CHANGELOG、没有未提交改动。');
  L.push('3. 归档文件**必须有【已归档】标记**（P2），否则那个目录会变成没人看得懂的垃圾桶。');
  L.push('4. 门禁 `run:` 到的脚本**不许被归档**（P4，双向对拍）。');
  L.push('');
  L.push('详见 [`scripts/archive/README.md`](archive/README.md)。');
  L.push('');
  L.push('「引用」列的四个标记：');
  L.push('`CI` = 门禁里每轮跑（`run: node scripts/…`）；');
  L.push('`提及` = 只在 `check.yml` 里出现过（`node --check` 文件列表或注释里 —— **不等于在跑**）；');
  L.push('`import` = 被别的脚本 `import`；`文档` = 在 `docs/*.md` 或 `README.md` 里被点名；`—` = 四处都没有。');
  L.push('');
  L.push('## 一览');
  L.push('');
  L.push('| 类别 | 个数 |');
  L.push('|---|---|');
  for (const c of ORDER) L.push(`| ${c} | ${byCat.get(c).length} |`);
  L.push(`| **合计** | **${all.length}** |`);
  L.push('');
  L.push('## ⚠ 没进 CI、没被 import、文档里也没提的');
  L.push('');
  L.push(`共 **${orphanAll.length}** 个。分两类看，性质完全不同：`);
  L.push('');
  L.push(`* **${orphanPatch.length} 个是一次性补丁**（名字带补丁前缀）—— 这是**正常的**：`);
  L.push('  它们本来就只跑一次，跑完留档当证据，**不需要**被任何东西引用。');
  L.push(`* **${orphanOdd.length} 个不是补丁命名** —— 这几个才值得看一眼：`);
  L.push('  名字像是"常驻工具"，却既不在门禁、也没被 import、文档里也没提。');
  L.push('  要么它是"还没归档的一次性补丁"，要么它是**真的没人用**。两种情况都值得看一眼，**但别直接删**。');
  L.push('');
  if (orphanOdd.length) {
    L.push('| 脚本 | 类别 | 一句话 |');
    L.push('|---|---|---|');
    for (const r of orphanOdd) L.push(`| \`${r.name}\` | ${r.cat} | ${r.one || '（文件头没写一句话）'} |`);
  } else {
    L.push('（没有 —— 每个"像常驻工具"的脚本都至少在门禁 / import / 文档里出现过一次）');
  }
  L.push('');
  L.push('<details><summary>补丁命名的那些（展开）</summary>');
  L.push('');
  L.push('| 脚本 | 一句话 |');
  L.push('|---|---|');
  for (const r of orphanPatch) L.push(`| \`${r.name}\` | ${r.one || '（文件头没写一句话）'} |`);
  L.push('');
  L.push('</details>');
  L.push('');
  for (const c of ORDER) {
    const list = byCat.get(c);
    L.push(`## ${c}（${list.length} 个）`);
    L.push('');
    if (c === '门禁') {
      L.push('每轮 CI 都跑；`CI 里的调用`一列**连参数一起抄**（参数丢了就是另一个命令，见 `tools/gate.mjs` 的文件头）。');
      L.push('');
      L.push('| 脚本 | CI 里的调用 | 一句话 |');
      L.push('|---|---|---|');
      for (const r of list) L.push(`| \`${r.name}\` | \`${(ci.get(r.name) || '').replace(/\|/g, '\\|')}\` | ${r.one || '（文件头没写一句话）'} |`);
    } else if (c === '一次性补丁') {
      L.push('**执行完只留档，不要删** —— 它们是"数据里这个值是怎么来的"的证据。');
      L.push('`引用`列若是 `—`，说明连语法检查名单都没进（那就更应该留着，否则它连被 `node --check` 摸一下的机会都没有）。');
      L.push('');
      L.push('| 脚本 | 引用 | 一句话 |');
      L.push('|---|---|---|');
      for (const r of list) L.push(`| \`${r.name}\` | ${r.usage} | ${r.one || '（文件头没写一句话）'} |`);
    } else {
      L.push('| 脚本 | 引用 | 一句话 |');
      L.push('|---|---|---|');
      for (const r of list) L.push(`| \`${r.name}\` | ${r.usage} | ${r.one || '（文件头没写一句话）'} |`);
    }
    L.push('');
  }
  L.push('## 已归档');
  L.push('');
  L.push(`\`scripts/archive/\` 里有 ${archive.length} 个更早的一次性补丁（v0.11–v0.44 一带）。`);
  L.push('它们**同样不删**：早期那几轮的数据是靠它们改出来的，出问题时得能翻回去看当时怎么改的。');
  L.push('');
  for (const f of archive) L.push(`* \`scripts/archive/${f}\``);
  L.push('');
  return L.join('\n');
}

/* ---------- 主流程 ---------- */
/* ⚠ 先判 `process.argv[1]` **存不存在**再 `pathToFileURL`。
 *   只写 `import.meta.url === pathToFileURL(process.argv[1]).href` 的话，
 *   在 `node --input-type=module -e '…import(…)…'` / 任何 `argv[1]` 为空的宿主里，
 *   **import 这一下就抛 `ERR_INVALID_ARG_TYPE`** —— 守卫 import 它会被绊倒，
 *   而报错看着像"路径写错了"，完全指不到这里（本轮当场踩到）。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const target = path.join(ROOT, 'scripts', 'README.md');
  const want = renderIndex(ROOT);
  if (check) {
    const have = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (have === want) {
      console.log('✓ scripts/README.md 与 scripts/ 现状一致');
      process.exit(0);
    }
    console.error('✗ scripts/README.md 与 scripts/ 现状不一致 —— 跑 `node scripts/make-scripts-index.mjs` 重新生成。');
    const a = have.split('\n'), b = want.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error(`  第一处不同在第 ${i + 1} 行：`);
        console.error(`    文件里： ${a[i] === undefined ? '(没有这一行)' : a[i]}`);
        console.error(`    应该是： ${b[i] === undefined ? '(不该有这一行)' : b[i]}`);
        break;
      }
    }
    process.exit(1);
  }
  fs.writeFileSync(target, want, 'utf8');
  console.log(`✓ 已写出 ${path.relative(ROOT, target).replace(/\\/g, '/')}（${want.split('\n').length - 1} 行）`);
  process.exit(0);
}
