#!/usr/bin/env node
/**
 * v0.178：修 4 处 `firstCh`（首次出场章）记晚了的记录 —— 依据 `audit-first-ch.mjs`。
 *
 * ## 这一批是怎么来的
 *
 * `audit-first-ch.mjs` 的「★最值得核：既不在名单里、也不在注释里」那一桶（7 条）
 * 逐条回原著读过之后，3 条是**真错**、2 条是**子串碰撞**（见下）、2 条是**被提及**。
 * 真错这 3 条都是同一个毛病：**把一个「更晚、更显眼的事件」当成了首次出场**。
 *
 * 外加 1 条**平行案例**（乐綝）：它和 张虎 在原文里是同一句话里的两个人
 * （「真又令张辽子张虎为先锋，乐进子乐綝为副先锋」），desc 也是同一个模板
 * （「…打阵被擒受辱。」），显然是一次批量填写留下的同一个错。
 * 它差 2 章、落在审计阈值（5）以下 ⇒ 审计**看不见它** —— 靠"平行案例"才捞出来。
 *
 * | 人物 | id | 旧 firstCh | 新 firstCh | 依据（原著逐字） |
 * |---|---|---|---|---|
 * | 张虎 | `zhang-hu` | 100 | **98** | 「张辽子张虎为先锋」@ 第九十八回 |
 * | 乐綝 | `yue-lin` | 100 | **98** | 「乐进子乐綝为副先锋」@ 第九十八回 |
 * | 王基 | `wang-ji` | 111 | **69** | 「安平太守王基，知辂神卜，延辂至家」@ 第六十九回 |
 * | 王双 | `wang-shuang` | 98 | **97** | 「乃陇西狄道人，姓王，名双，字子全」@ 第九十七回 |
 *
 * ⚠ 每条的定位短语必须在原著里**逐字存在**（去空白后），否则本脚本拒绝并 exit 1。
 *   —— 没有原文依据不许改数据（项目铁律）。
 *
 * ## 三处「查过之后决定不动」的（如实记下来，免得下轮重查）
 *
 * 1. **王双 第 85 回那次「王双」存疑、不改到 85。** 第 85 回曹仁濡须之战里有
 *    「常雕，同诸葛虔、王双，引五万精兵」；但**第九十七回**才给他完整介绍
 *    （籍贯 + 字 + 「臣保此人为先锋」+ 上殿受封）——那是作者标记"新人物登场"的标准写法。
 *    同回的 常雕 / 诸葛虔 **都不在数据里**（数据不收一回即死的龙套），
 *    所以数据里的王双就是第 97 回那位。⇒ 取 97。
 * 2. **张虎 第 7 回的「江夏张虎」是另一个人**（黄祖部将，被韩当一刀削去半个脑袋），
 *    数据里的张虎是**张辽之子**。同回的搭档「陈生」也不在数据里 ⇒ **不新增人物**，
 *    只把 firstCh 改到张辽之子真正出场的那一回（98）。
 * 3. **`title` 字段不动。** 王基的 `title` 写「镇南将军·正先锋」（那是第 111 回的官职），
 *    改成「安平太守」会影响别处对 title 的展示口径；本轮只动 `firstCh` 与 `desc`
 *    （`desc` 的语义就是"该人物在 firstCh 那回的简介"，见 `data/README`/记忆）。
 *
 * 用法：`node scripts/fix-first-ch.mjs`（预览）／`node scripts/fix-first-ch.mjs --write`
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');
const SRC = path.join(os.tmpdir(), 'opencode', 'ba-books', '三国演义.txt');

if (!fs.existsSync(SRC)) {
  console.error(`✗ 找不到原著文本：${SRC}`);
  console.error('  没有原文不判断出场章 —— 中止。');
  process.exit(1);
}
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');
const f = flat(fs.readFileSync(SRC, 'utf8'));

/* ── 四条改动：[id, 新 firstCh, 新 desc, 定位短语, 说明] ── */
const JOBS = [
  ['zhang-hu', 98, '魏将，张辽之子；为曹真先锋，与乐綝同守头营',
    '张辽子张虎为先锋',
    '第 98 回「真又令张辽子张虎为先锋，乐进子乐綝为副先锋，同守头营」——这是他的首次出场。' +
    '原来记 100 回，用的是"打阵被擒受辱"（第 100 回八门金锁阵）那次更显眼的事件。'],
  ['yue-lin', 98, '乐进之子；为曹真副先锋，与张虎同守头营',
    '乐进子乐綝为副先锋',
    '与张虎同一句话（第 98 回）。旧 desc「乐进之子，打阵被擒受辱。」与张虎的旧 desc 同模板 ⇒ 同一次批量填写的同一个错。' +
    '⚠ 它只差 2 章、在审计阈值以下 ⇒ 审计报不出来，靠"平行案例"捞到的。'],
  ['wang-ji', 69, '魏安平太守；闻管辂善卜，延请至家问卜',
    '安平太守王基，知辂神卜，延辂至家',
    '第 69 回管辂故事里他就是「安平太守王基」。数据里本来就有一条 `管辂 —延请卜卦→ 王基`，' +
    '却把 firstCh 记成 111 ⇒ 自相矛盾。原来记 111 回，用的是"魏军正先锋，败吴兵"。'],
  ['wang-shuang', 97, '魏将，陇西狄道人，字子全；曹真保荐为前部先锋',
    '乃陇西狄道人，姓王，名双，字子全',
    '第 97 回给了他完整介绍（籍贯/字/上殿受封虎威将军）并当场斩谢雄、龚起 ⇒ 首次出场是 97 不是 98。' +
    '原来记 98 回，用的是"引兵小路巡哨，追魏延"（第 98 回）那次。'],
];

const raw = fs.readFileSync(FILE, 'utf8');
const book = JSON.parse(raw);
const byId = new Map(book.characters.map((c) => [c.id, c]));

/* ── 一、先核定位短语（没有原文依据直接拒绝） ── */
console.log('═══ 一、定位短语核验（必须在原著里逐字存在）═══\n');
let bad = 0;
for (const [id, , , locate, why] of JOBS) {
  const n = f.split(flat(locate)).length - 1;
  const ok = n >= 1;
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${byId.get(id)?.name ?? id}：${ok ? `「${locate}」在原文里出现 ${n} 次` : `「${locate}」原文里找不到`}`);
  if (ok) console.log(`      ${why}`);
}
if (bad) { console.error(`\n⇒ ${bad} 条定位短语核验不过 —— 拒绝改任何数据`); process.exit(1); }

/* ── 二、逐条改：在**该人物的对象块内**做字面替换（不整文件重序列化） ── */
/**
 * ⚠ `data/three-kingdoms.json` **不是** `JSON.stringify(x, null, 2)` 的输出
 *   （实测：96 行不同 —— 有几处数组被写成单行），所以**不能** parse→stringify 落盘，
 *   否则全文件重写。这里按"对象块内字面替换 + 落盘后 parse 回来深比对"来做。
 */
function patchObjectBlock(text, id, edits) {
  const key = `"id": ${JSON.stringify(id)},`;
  const ki = text.indexOf(key);
  if (ki < 0) throw new Error(`找不到 id=${id} 的记录`);
  const start = text.lastIndexOf('\n    {', ki);
  const end = text.indexOf('\n    }', ki);
  if (start < 0 || end < 0 || end < ki) throw new Error(`id=${id} 的对象块边界找不到`);
  let block = text.slice(start, end);
  for (const [from, to] of edits) {
    const cnt = block.split(from).length - 1;
    if (cnt !== 1) throw new Error(`id=${id}：要替换的片段出现 ${cnt} 次（应为 1 次）→ ${from}`);
    block = block.split(from).join(to);
  }
  return text.slice(0, start) + block + text.slice(end);
}

console.log('\n═══ 二、改动 ═══\n');
let out = raw;
const plan = [];
for (const [id, newCh, newDesc, , ] of JOBS) {
  const c = byId.get(id);
  if (!c) { console.error(`  ✗ 找不到 ${id}`); process.exitCode = 1; continue; }
  const oldCh = Number(c.firstCh);
  if (oldCh === newCh && c.desc === newDesc) { console.log(`  (跳过) ${c.name} 已是目标值`); continue; }
  if (!Number.isFinite(oldCh)) { console.error(`  ✗ ${c.name} 没有 firstCh`); process.exitCode = 1; continue; }
  if (newCh >= oldCh) {
    console.error(`  ✗ ${c.name}：新 firstCh(${newCh}) 不早于旧值(${oldCh}) —— 本脚本只处理"记晚了"`);
    process.exitCode = 1; continue;
  }
  const edits = [
    [`"firstCh": ${oldCh},`, `"firstCh": ${newCh},`],
    [`"desc": ${JSON.stringify(c.desc)},`, `"desc": ${JSON.stringify(newDesc)},`],
  ];
  out = patchObjectBlock(out, id, edits);
  plan.push({ id, name: c.name, oldCh, newCh, oldDesc: c.desc, newDesc });
  console.log(`  ${c.name.padEnd(4)} firstCh ${oldCh} → ${newCh}`);
  console.log(`      desc 旧: ${c.desc}`);
  console.log(`      desc 新: ${newDesc}`);
}
if (process.exitCode) { console.error('\n⇒ 有改动没法安全落地，未写盘'); process.exit(1); }

/* ── 三、落盘前深比对：解析回来必须与预期对象逐字段相同 ── */
const got = JSON.parse(out);
for (const p of plan) {
  const c = got.characters.find((x) => x.id === p.id);
  if (Number(c.firstCh) !== p.newCh || c.desc !== p.newDesc) {
    console.error(`  ✗ 深比对失败：${p.name} → firstCh=${c.firstCh} desc=${c.desc}`);
    process.exit(1);
  }
}
/* 除这 4 处外不许有任何别的差异 */
const before = JSON.stringify(book);
const after = JSON.stringify(got);
const diffIds = [];
for (const c0 of book.characters) {
  const c1 = got.characters.find((x) => x.id === c0.id);
  if (JSON.stringify(c0) !== JSON.stringify(c1)) diffIds.push(c0.id);
}
const expected = new Set(plan.map((p) => p.id));
const unexpected = diffIds.filter((id) => !expected.has(id));
if (unexpected.length) { console.error(`  ✗ 有意料之外的改动：${unexpected.join(', ')}`); process.exit(1); }
console.log(`\n  深比对：只动了 ${diffIds.length} 个记录（${diffIds.join(', ')}）—— 与预期一致`);
console.log(`  （序列化长度 ${before.length} → ${after.length}，差 ${after.length - before.length} 字符）`);

console.log(`\n═══ 三、结果 ═══\n  共改 ${plan.length} 处`);
console.log(WRITE ? '  已写入' : '  预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, out, 'utf8');
