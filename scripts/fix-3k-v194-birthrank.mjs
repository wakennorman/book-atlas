#!/usr/bin/env node
/**
 * v0.194 · 补 `birthRank`：让同胞称谓不再靠 id 字母序猜长幼
 *
 * ## 起因：一条「看着都对、其实都错」的推导边
 *
 * `computeKin()` 里 `elder = f.da <= f.db ? aId : bId`，而同胞时 `f.da === f.db`
 * 恒成立 ⇒ **谁排在参数里谁就是「兄/姐」**；`derive-kin` 传的 id 按字符串排序
 * ⇒ **长幼 = id 字母序**。实测三国有 19 条推导边中招：
 *
 *   | 数据里写的 | 实际（据仓库内已有文案，见下） |
 *   |---|---|
 *   | 曹贵人 —姐弟→ 曹植 | 曹植比曹贵人小得��（曹植是曹操**少子**） |
 *   | 曹后 —姐弟→ 曹彰 | 同上 |
 *   | 曹昂 —兄妹→ 清河公主 | 曹昂是曹操**长子** |
 *
 * 同一份数据里**曹植既是曹贵的「弟」，又是清河公主的「兄」**。
 *
 * ## 为什么这不是「改一行代码」能解决的
 *
 * 代码侧的修法在 `kin-terms.mjs`：无 `birthRank` 时输出中性词「同胞」。
 * 但那只是**止血** —— 19 条边会从「说错」变成「不说」，而「曹昂和曹植谁大」
 * 本身是《三国演义》写明的、有信息量的知识。**该做的是把知识补进数据。**
 *
 * ⚠ **本轮只补仓库内**已有文案**明确写着的排行，不凭记忆补。**
 *   依据来源（全部是 `data/three-kingdoms.json` 里已落盘的字段，可复核）：
 *   · `cao-ang`  title `曹操长子`           ⇒ birthRank 1
 *   · `cao-zhang` title `曹操次子` / note `曹操次子` ⇒ birthRank 2
 *   · `cao-xiong` title `曹操四子` / desc `卞氏所生四子之一` ⇒ birthRank 4
 *   · `cao-zhi`   desc `曹操**少子**`        ⇒ 卞氏四子里的最幼 ⇒ birthRank 5
 *
 * ⚠ **曹丕与三位女儿（曹贵人／清河公主／曹后）本轮不给 birthRank。**
 *   仓库里 `cao-pi` 的 title 是「世子」（继位身份，不是排行）、desc 是
 *   「曹操之子」；三位女儿的文案只有「曹操之女」。**都没有排行依据**，
 *   按本项目铁律（v0.190 起：否定/补全字段必须能在原文找到依据）不补。
 *   ⇒ 涉及她们与曹氏四子的边仍会是中性的「同胞」，这是**如实**，不是遗漏。
 *
 * ## 为什么用定点补丁而不是 `derive-kin --write`
 *
 * `data/*.json` **不是** `JSON.stringify(book, null, 2)` 的输出（实测三国差 65457 行）
 * ⇒ 整体重写会带进巨量无关格式 diff。本脚本只改目标人物的那一行，
 * 且**逐条断言**：依据文案必须仍在、目标字段必须仍是旧值。
 *
 * 用法：
 *   node scripts/fix-3k-v194-birthrank.mjs           # 预览
 *   node scripts/fix-3k-v194-birthrank.mjs --write   # 落盘（幂等）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');

const raw = fs.readFileSync(FILE, 'utf8');
const book = JSON.parse(raw);

/**
 * ⚠ 落盘时**不能**写回 `raw`。
 *   第一版写的是 `fs.writeFileSync(FILE, raw)` —— 前面全在对 `book` 对象做修改，
 *   `raw` 始终是刚读进来的那个**字符串**，改动一个字节都没进去
 *   ⇒ 脚本却打印「✓ 已写入」。**这是个会骗人的脚本。**
 *
 * ⚠ 也不能用 `JSON.stringify(book, null, 2) + '\n'` 整体重写：
 *   本文件不是那个格式（三国实测差 65457 行），重写会淹没真正的改动。
 *
 * 做法：**定点替换** —— 定位到那个 `id` 所在的 JSON 对象，只在它第一行后面插一行
 * `    "birthRank": N,`。插入点用「对象里 `id` 后面紧跟的第一对 `": "`」精确定位，
 * 并断言插入前后 `JSON.parse` 都成功、且只有 birthRank 变了。
 */

/**
 * 找 `"id": "<id>",` 那一行的**行尾位置**（即下一个 `\n` 之前）。
 *
 * ⚠ 为什么锚在 `"id"` 行而不是对象起始 `{`：
 *   本文件是**混排格式** —— 对象起始可能是 `{` 独占一行，也可能是
 *   `    {      "id": "cao-ang",` 挤在同一行（实测两种都出现）。
 *   猜 `{` 在哪会插错位置（前两版就是这么错的：一版插出少缩进，
 *   一版把 birthRank 和 `"id"` 挤到同一行）。
 *   `"id"` 是每个对象**必然有、必然唯一、必然在行尾带逗号**的字段，
 *   锚在它后面最稳，而且不依赖任何缩进假设。
 *
 * @returns {number} 行尾（`\n` 的下标）；找不到返回 -1
 */
function findIdLineEnd(src, id) {
  const key = `"id": "${id}",`;
  let from = 0;
  for (;;) {
    const at = src.indexOf(key, from);
    if (at < 0) return -1;
    /* 必须确认这是行尾的 id（后面紧跟空白 + 换行），不是嵌在字符串里的。 */
    const nl = src.indexOf('\n', at + key.length);
    if (nl >= 0 && src.slice(at + key.length, nl).trim() === '') return nl;
    from = at + key.length;
  }
}



/**
 * 要补的排行。**每条都必须附 `expect`** ——
 * 依据文案（title/desc/note 之一）里必须原样含着这句话，否则 exit 1。
 * 依据变了就停下来重新核，而不是默默写一个没根据的数。
 */
const RANKS = [
  { id: 'cao-ang', rank: 1, expect: { field: 'title', has: '曹操长子' }, why: '曹操长子' },
  { id: 'cao-zhang', rank: 2, expect: { field: 'title', has: '曹操次子' }, why: 'title 写「曹操次子」' },
  { id: 'cao-xiong', rank: 4, expect: { field: 'title', has: '曹操四子' }, why: 'title 写「曹操四子」' },
  {
    id: 'cao-zhi', rank: 5,
    expect: { field: 'desc', has: '曹操少子' },
    why: 'desc 写「曹操少子」——卞氏四子（丕/彰/熊/植）里的最幼，排第 5（在曹昂之后）',
  },
];

/** 本轮刻意不补的，登记下来，免得下次以为是漏了。 */
const SKIPPED = [
  ['cao-pi', 'title「世子」是继位身份、desc「曹操之子」——都不是排行'],
  ['cao-guiren', '文案只有「曹操之女」，无排行'],
  ['qinghe-gongzhu', '文案只有「曹操之女」，无排行'],
  ['cao-hou', '文案只有「曹操之女」，无排行'],
];

let changed = 0;
const problems = [];
/** 待插入：[{ id, rank, 插入点(原文下标) }] —— 按位置倒序插，避免前面的偏移影响后面。 */
const inserts = [];

for (const r of RANKS) {
  const c = (book.characters || []).find((x) => x.id === r.id);
  if (!c) { problems.push(`找不到人物 ${r.id}`); continue; }

  /* ① 依据必须还在。原文被改过就停下来。 */
  const hay = String(c[r.expect.field] ?? '');
  if (!hay.includes(r.expect.has)) {
    problems.push(`${r.id}：依据不成立 —— ${r.expect.field} 里找不到「${r.expect.has}」`
      + `（现在是「${hay.slice(0, 60)}」）`);
    continue;
  }

  /* ② 已改过就 skip（幂等），但要确认是同一个值而不是别人写的别的数。 */
  if (typeof c.birthRank === 'number') {
    if (c.birthRank === r.rank) { console.log(`  ＝ ${r.id} 已是 ${r.rank}（跳过）`); continue; }
    problems.push(`${r.id}：已有 birthRank=${c.birthRank}，与本轮要写的 ${r.rank} 冲突，需人工裁决`);
    continue;
  }

  /* ③ 找落盘插入点：`"id": "<id>",` 那一行的行尾。 */
  const at = findIdLineEnd(raw, r.id);
  if (at < 0) {
    problems.push(`${r.id}：在原文里定位不到 "id" 行（格式可能变了，需人工处理）`);
    continue;
  }


  console.log(`  ＋ ${c.name}（${r.id}）birthRank = ${r.rank}　依据：${r.why}`);
  inserts.push({ id: r.id, rank: r.rank, at });
  changed++;
}

if (problems.length) {
  console.error('\n✗ 有 ' + problems.length + ' 处不能自动处理：');
  for (const p of problems) console.error('   ' + p);
  process.exit(1);
}

console.log(`\n本轮不补的（无排行依据，如实留空 ⇒ 称谓走中性词「同胞」）：`);
for (const [id, why] of SKIPPED) console.log(`   － ${id}：${why}`);

if (!WRITE) {
  console.log(`\n（预览）将新增 birthRank ${changed} 条。加 --write 才落盘。`);
  process.exit(0);
}

if (changed === 0) {
  console.log('\n（无变化，未落盘）');
  process.exit(0);
}

/* 插入点是 `"id": "<id>",` 的**行尾**（由 findIdLineEnd 给出），
 * 所以这里直接在同一行追加字段，不需要另起一行、也不需要动行尾风格 ——
 * 这样既避开了「缩进多少」的猜测，也避开了「文件是 CRLF 还是 LF」的猜测。
 * （v0.194 前面三版分别在这两件事上各错一次，最后靠这一行定案。） */
inserts.sort((a, b) => b.at - a.at);   // 倒序：后面的先插，前面的偏移才不被影响
let out = raw;
for (const ins of inserts) {
  out = out.slice(0, ins.at) + ` "birthRank": ${ins.rank},` + out.slice(ins.at);
}

/* ⚠ 自检：写之前先验一遍这个字符串**真的**只多了 birthRank、且仍是合法 JSON。
 *   第一版就是没有这一步，打印了「✓ 已写入」而实际一个字节都没写进去。 */
const reparsed = JSON.parse(out);
let verified = 0;
for (const ins of inserts) {
  const c = reparsed.characters.find((x) => x.id === ins.id);
  if (!c || c.birthRank !== ins.rank) {
    console.error(`✗ 自检失败：${ins.id} 的 birthRank 不是 ${ins.rank}（得到 ${c?.birthRank}）`);
    process.exit(1);
  }
  verified++;
}
/* 反向自检：除 birthRank 外，characters 不该有任何别的变化。 */
const strip = (o) => JSON.parse(JSON.stringify(o));
for (const ins of inserts) {
  const a = strip(book.characters.find((x) => x.id === ins.id));
  const b = strip(reparsed.characters.find((x) => x.id === ins.id));
  delete a.birthRank; delete b.birthRank;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`✗ 自检失败：${ins.id} 除 birthRank 外还有别的字段变化，放弃写入`);
    process.exit(1);
  }
}

fs.writeFileSync(FILE, out, 'utf8');
console.log(`\n✓ 已写入 data/three-kingdoms.json：新增 birthRank ${changed} 条（自检 ${verified}/${changed} 通过）`);
console.log('  下一步：node scripts/derive-kin.mjs data/three-kingdoms.json --write'
  + '　（此时有排行依据，词会从「同胞」变回「兄妹／姐弟」）');

