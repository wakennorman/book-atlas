#!/usr/bin/env node
/**
 * v0.108：收尾四项 —— 公孙家世系、孙綝代号、三处亲子边方向、曹节性别
 *
 * ## 先撤回一条我自己的错报
 *
 * 上一条报告说「吴太夫人那 3 条边写成父子，实际是母子」。**那条是错的。**
 * 我把自查脚本输出里的列标题 `父:` 当成了 type。实际数据里是
 *     吴太夫人 —母子— 孙策　✓　吴太夫人 —母子— 孙权　✓　吴太夫人 —母女— 孙夫人　✓
 * 三条都对。**教训：报告里的"类型"要从 type 字段读，不能从列标题读。**
 *
 * ## 真问题一：公孙家（v0.105 里我又换反了一次）
 *
 *     公孙渊 —父子— 公孙康   文案「康死，其子公孙渊长大继据辽东」
 *   ⇒ 公孙康 才是公孙渊的父亲。这条边**原本是对的**，是我 v0.105 看到
 *     「公孙康 gen2 / 公孙渊 gen1」代号递增就照单全收换反的。
 *     **和孙登那次是同一个错误，同一批里犯了两次。**
 *
 *     公孙度 —父子— 公孙恭   文案「公孙康死后，其弟公孙恭继其职」
 *   ⇒ 公孙恭是公孙**康**的弟弟。这条不是"方向反了"，是 from 填错了人，
 *     所以单列 REPOINT（改指向），不能当换方向处理。
 *
 *   代号（公孙度 gen1 为基准）：公孙度 1 → 公孙康 2、公孙恭 2（弟）→ 公孙渊 3 → 公孙修 4
 *
 * ## 真问题二：孙綝 的代号
 *
 * 「孙峻病亡，**从弟**孙綝辅政」⇒ 孙綝与孙峻同代。
 * 孙峻 gen4（已对：「孙峻乃孙静曾孙」）⇒ 孙綝 应为 gen4，原为 gen1。
 *
 * ## 真问题三：三条方向反了的亲子边
 *
 * `audit-kin-direction.mjs` 只查**代号递增**，父子**同代**的方向错误它看不见。
 * 这三条靠 type 与 gender 对不上抓出来，文案都明写了母亲：
 *     王经 —母子— 王经母　　　「母子同赴东市」
 *     汉灵帝 —母子— 董太后　　「灵帝入继大统，迎养母氏于宫中」
 *     罗季昂 —母子— 普尔赫莉雅「母亲普尔赫莉雅从外省寄来长信」
 *
 * ## 真问题四：曹节 的性别
 *
 * `曹操 —父女— 曹节` 但 gender=m。「曹**后**称吾父功盖寰区」⇒ 应为 f。
 *
 * ## ⚠ 三条实现约束（都是前几轮踩出来的）
 *
 * 1. **一律按名字查人**，不用手写 id。v0.105/v0.106 两次因为猜 id 把排行
 *    按到了刘琮头上、把代号改到了不相干的人身上。
 * 2. **先改代号，再换方向**。第一版把 SWAP 放在 REGEN 前面，于是
 *    「公孙康 gen2 > 公孙渊 gen1，代号不支持」把该改的那条挡住了 ——
 *    和 v0.106 里「孙河已改名、birthRank 还在期待旧名」是同一种顺序依赖。
 * 3. **"这本书里没这个人"不等于"拒绝"**。前者静默跳过，后者才报警。
 *
 * 用法：node scripts/fix-rest.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

/** 代号：[名字, 应为, 依据] —— 必须先跑 */
const REGEN = [
  ['公孙渊', 3, '公孙康 gen2 之子'],
  ['孙綝', 4, '「孙峻病亡，从弟孙綝辅政」⇒ 与孙峻（gen4）同代'],
];

/** 换方向：[父名, 子名, 依据] —— from 现在是子，要换成父 */
const SWAP = [
  ['公孙康', '公孙渊', '「康死，其子公孙渊长大继据辽东」⇒ 公孙康 是父亲'],
  ['王经母', '王经', '「母子同赴东市」⇒ 王经母 是母亲'],
  ['董太后', '汉灵帝', '「灵帝入继大统，迎养母氏于宫中」⇒ 董太后 是养母'],
  ['普尔赫莉雅·亚历山大罗芙娜·拉斯柯尔尼科娃', '罗季昂·罗曼内奇·拉斯柯尔尼科夫',
    '「母亲普尔赫莉雅从外省寄来长信」⇒ 普尔赫莉雅 是母亲'],
];

/** 改指向：[现from名, to名, 应改为from的名, 依据] */
const REPOINT = [
  ['公孙度', '公孙恭', '公孙康', '「公孙康死后，其弟公孙恭继其职」⇒ 公孙恭 是公孙康的弟弟'],
];

/** 性别：[名字, 应为, 依据] */
const GENDER = [['曹节', 'f', '「曹后称吾父功盖寰区」⇒ 曹操之女']];

let refused = 0;
const refusedList = [];
const refuse = (msg) => { refused++; refusedList.push(msg); console.log(`  ⛔ ${msg}`); };

for (const slug of ['three-kingdoms', 'crime-and-punishment']) {
  const file = path.join(ROOT, 'data', `${slug}.json`);
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byName = new Map(book.characters.map((c) => [c.name, c]));
  const nm = (id) => book.characters.find((c) => c.id === id)?.name ?? id;
  const touched = new Set();

  console.log(`\n${'═'.repeat(66)}\n【${slug}】`);

  /* ── 一、代号（必须最先：后面的代号校验依赖它） ── */
  console.log('\n一、代号纠正');
  for (const [name, gen, why] of REGEN) {
    const c = byName.get(name);
    if (!c) continue;                       // 这本书没这个人 ⇒ 静默跳过
    if (c.generation === gen) { console.log(`  (跳过) ${c.name} 已是 gen${gen}`); continue; }
    console.log(`  ${c.name.padEnd(8)} gen${c.generation} → gen${gen}　（${why}）`);
    c.generation = gen;
    touched.add(c.id);
  }

  /* ── 二、换方向 ── */
  console.log('\n二、换方向（from/to 对调）');
  for (const [pname, cname, why] of SWAP) {
    const p = byName.get(pname), c = byName.get(cname);
    if (!p || !c) continue;
    const r = book.relations.find((x) => x.from === c.id && x.to === p.id && !x.derived);
    if (!r) { refuse(`${slug}：找不到记反的边 ${cname} → ${pname}`); continue; }
    if (p.generation > c.generation) {
      refuse(`${slug}：${pname}(gen${p.generation}) > ${cname}(gen${c.generation})，代号不支持，仍不换`);
      continue;
    }
    console.log(`  ${cname} —${r.type}— ${pname}   ⇒  ${pname} —${r.type}— ${cname}`);
    console.log(`      ${why}`);
    if (r.fromCh != null || r.toCh != null) { const t = r.fromCh; r.fromCh = r.toCh; r.toCh = t; }
    r.from = p.id; r.to = c.id;
    touched.add(p.id); touched.add(c.id);
  }

  /* ── 三、改指向 ── */
  console.log('\n三、改指向（from 填错了人）');
  for (const [curName, toName, newFrom, why] of REPOINT) {
    const cur = byName.get(curName), c = byName.get(toName), nf = byName.get(newFrom);
    if (!cur || !c || !nf) continue;
    const r = book.relations.find((x) => x.from === cur.id && x.to === c.id && !x.derived);
    if (!r) { refuse(`${slug}：找不到边 ${curName} → ${toName}`); continue; }
    if (nf.generation > c.generation) {
      refuse(`${slug}：${newFrom}(gen${nf.generation}) > ${toName}(gen${c.generation})，代号不支持，仍不改`);
      continue;
    }
    console.log(`  ${curName} —${r.type}— ${toName}   ⇒  ${newFrom} —${r.type}— ${toName}`);
    console.log(`      ${why}`);
    if (r.fromCh != null && r.toCh != null) r.fromCh = r.toCh;
    r.from = nf.id;
    touched.add(cur.id); touched.add(c.id); touched.add(nf.id);
  }

  /* ── 四、性别 ── */
  console.log('\n四、性别纠正');
  for (const [name, g, why] of GENDER) {
    const c = byName.get(name);
    if (!c) continue;
    if (c.gender === g) { console.log(`  (跳过) ${c.name} 已是 ${g}`); continue; }
    console.log(`  ${c.name.padEnd(8)} gender ${c.gender} → ${g}　（${why}）`);
    c.gender = g;
    touched.add(c.id);
  }

  console.log(`\n  本书改动 ${touched.size} 人`);
  if (WRITE && touched.size) fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
}

console.log(`\n${'─'.repeat(66)}`);
if (refused) {
  console.log(`⚠ 有 ${refused} 条被拒绝，需要单独查：`);
  for (const r of refusedList) console.log(`   ${r}`);
} else console.log('✓ 没有被拒绝的条目');
if (!WRITE) console.log('（预览模式，加 --write 才落盘）');
