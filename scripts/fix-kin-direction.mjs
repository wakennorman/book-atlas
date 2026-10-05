#!/usr/bin/env node
/**
 * 修 audit-kin-direction.mjs 报出的父子边问题（v0.105）。
 *
 * 每一条都在《三国演义》原文里找到过佐证后才动手，出处写在 SRC 里。
 * **只修"两个独立信号一致"的那些**：代号递增（结构信号）+ 原文亲缘称呼（文本信号）。
 *
 * ## 约定：from = 父母，to = 子女
 *
 * ## ⚠ 加了名字断言，因为第一版靠猜 id 就写坏了人
 *
 * 第一版 RANKS 里写 `['liu-cong', 3, '「三子刘悰」']` —— 而 `liu-cong` 是**刘琮**
 * （刘表的儿子），跟刘禅的第三子刘悰毫无关系；`['liu-xun', 6, ...]` 命中的是**刘勋**。
 * id 是我猜的，猜错就把排行按到了不相干的人头上，而输出看起来"一切正常"。
 * 所以每条都必须带 `name` 断言，对不上就跳过并报错，绝不写。
 *
 * 用法：node scripts/fix-kin-direction.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');

/**
 * 一、换方向。每条 = [父id, 父名, 子id, 子名, 原文依据]
 * 数据里现在记反了：`from` 是儿子、`to` 是父亲。改成 from=父。
 */
const SWAP = [
  ['sun-jian', '孙坚', 'sun-quan', '孙权', '「谥父孙坚为武烈皇帝」'],
  ['sun-deng', '孙登', 'sun-quan', '孙权', '「立子孙登为皇太子」'],
  ['liu-xuan', '刘璿', 'liu-shan', '刘禅', '「后主生七子，长子刘璿」'],
  ['zhuge-zhan', '诸葛瞻', 'zhuge-liang', '诸葛亮', '「其子诸葛瞻守孝居丧」'],
  ['liu-zhang', '刘璋', 'liu-xun-zhangzi', '刘循', '刘循为刘璋之子，守雒城'],
  ['xiahou-yuan', '夏侯渊', 'xiahou-mao', '夏侯楙', '「上报国恩下报父仇」'],
  ['gongsun-yuan', '公孙渊', 'gongsun-kang', '公孙康', '「康死，其子公孙渊」'],
  ['lu-jun', '陆骏', 'lu-xun', '陆逊', '「叙其为九江都尉陆骏之子」'],
  ['quan-shang', '全尚', 'quan-ji', '全纪', '「全纪受诏归家密告其父」'],
];

/** 二、边没错、只有代号错的：[id, 名字, 新代号, 依据] */
const REGEN = [['fu-wan', '伏完', 0, '「乃伏皇后之父伏完也」；伏皇后 gen1，其父应高一档']];

/** 三、名字错的：[id, 现名, 应为, 依据] */
const RENAME = [['sun-he', '孙河', '孙和', '原著「孙河」0 次、「孙和」3 次']];

/** 四、原文明写排行 ⇒ birthRank：[id, 名字, 排行, 依据] */
const RANKS = [
  ['sun-deng', '孙登', 1, '「先有太子孙登」（先立者为长子）'],
  /* ⚠ 这里期望的是 RENAME **之后**的名字。三节先跑，所以写「孙和」。
   *   第一版写的是「孙河」，结果被名字断言拒掉 —— 断言抓到了顺序依赖，这是它该做的。 */
  ['sun-he', '孙和', 2, '「遂立次子孙和为太子」'],
  ['sun-liang', '孙亮', 3, '「又立三子孙亮为太子」'],
  ['liu-xuan', '刘璿', 1, '「长子刘璿」'],
  ['liu-chen', '刘谌', 5, '「五子即北地王刘谌」'],
];

/** 五、原著里查无此人 —— 不动，报出来 */
const NOVEL_ABSENT = [['zhuge-gui', '诸葛珪']];

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(book.characters.map((c) => [c.id, c]));
const nm = (id) => byId.get(id)?.name ?? id;
let changed = 0;
const refused = [];

/** 名字断言：id 对但名字不对 ⇒ 拒绝写入。 */
function guard(id, expect) {
  const c = byId.get(id);
  if (!c) { refused.push(`${id}　人物不存在`); return null; }
  if (c.name !== expect) { refused.push(`${id}　期望「${expect}」，实际「${c.name}」⇒ 拒绝写入`); return null; }
  return c;
}

console.log('=== 一、换方向（from/to 对调）===');
for (const [pid, pname, cid, cname, src] of SWAP) {
  const p = guard(pid, pname), c = guard(cid, cname);
  if (!p || !c) continue;
  const r = book.relations.find((x) => x.from === cid && x.to === pid && !x.derived);
  if (!r) { refused.push(`${pname}/${cname}　找不到记反的边 ${cname} → ${pname}`); continue; }
  if (!(p.generation <= c.generation)) {
    refused.push(`${pname}/${cname}　代号不支持这次修正（父 gen${p.generation} > 子 gen${c.generation}）`);
    continue;
  }
  console.log(`  ${cname}（gen${c.generation}）—${r.type}— ${pname}（gen${p.generation}）`);
  console.log(`      ⇒ 改为 ${pname} —${r.type}— ${cname}　（${src}）`);
  if (r.fromCh != null || r.toCh != null) { const t = r.fromCh; r.fromCh = r.toCh; r.toCh = t; }
  r.from = pid; r.to = cid;
  changed++;
}

console.log('\n=== 二、代号纠正 ===');
for (const [id, name, gen, why] of REGEN) {
  const c = guard(id, name);
  if (!c) continue;
  console.log(`  ${c.name}　gen${c.generation} → gen${gen}　（${why}）`);
  c.generation = gen;
  changed++;
}

console.log('\n=== 三、名字纠正 ===');
for (const [id, cur, to, why] of RENAME) {
  const c = guard(id, cur);
  if (!c) continue;
  console.log(`  ${c.name} → ${to}　（${why}）`);
  c.name = to;
  if (Array.isArray(c.aliases)) c.aliases = c.aliases.map((a) => a.replace(/俞河/g, to).replace(/名河/g, to));
  changed++;
}

console.log('\n=== 四、补 birthRank（原文明写排行）===');
for (const [id, name, rank, why] of RANKS) {
  const c = guard(id, name);
  if (!c) continue;
  if (c.birthRank != null) { console.log(`  (跳过) ${c.name} 已有 birthRank=${c.birthRank}`); continue; }
  console.log(`  ${c.name.padEnd(8)} birthRank=${rank}　（${why}）`);
  c.birthRank = rank;
  changed++;
}

console.log('\n=== 五、查无此人，不动，报出来 ===');
for (const [id, name] of NOVEL_ABSENT) {
  const c = byId.get(id);
  if (!c) { console.log(`  （已不存在）${id}`); continue; }
  console.log(`  ⚠ ${c.name}：原文出现 0 次`);
  for (const r of book.relations.filter((x) => x.from === id || x.to === id)) {
    console.log(`     ${nm(r.from)} —${r.type}— ${nm(r.to)}${r.derived ? '  [推导]' : ''}`);
  }
  console.log(`     ⇒ 需你定夺：删掉（连同这些边），还是保留并标注"小说未点名"？`);
}

if (refused.length) {
  console.log(`\n=== 拒绝写入 ${refused.length} 条（名字/代号对不上，绝不猜）===`);
  for (const r of refused) console.log(`  ⛔ ${r}`);
}

console.log(`\n合计改动 ${changed} 处${WRITE ? '（已写入）' : '（预览，加 --write 才落盘）'}`);
if (WRITE && changed) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
