#!/usr/bin/env node
/**
 * v0.159：① 合并「雷同（雒城）」与「雷同（巴西）」—— **同一个人**；
 *         ② 给 6 个人补 `firstCh` / `faction`（回原著逐字核，不用启发式）。
 *
 * ## 一、为什么雷同是一个人（而不是 v0.97 判的"两个人"）
 *
 * 原著只有**一个**雷同，一条连续人生（`雷同` 28 次 / `雷铜` 0 次）：
 *
 *   第62回  「吴懿保吴兰、雷同二人为副将」          　　← 刘璋部将，随吴懿赴雒城
 *   第64回  「吴兰、雷同料敌不住，只得将本部军马前来投降。玄德准其降」
 *   第65回  「其余吴懿…吴兰、雷同…文武投降官员共六十余人」 ← 随刘璋降刘备
 *   第69回  「时张飞自与雷同守把巴西」              　　← 已是张飞部将
 *   第70回  「张郃复回，刺雷同于马下」              　　← 死于张郃
 *
 * 中间**没有第二个人被引出来** —— 当年 `docs/新书处理规程.md` §2.7 只看了首尾两句
 * （62 回、70 回）就判「两个不同的人」，把"隔得远"当成了"不是同一人"。
 * 而该节自己写的判据正是「同名的段落**逐条读**，看是不是同一段人生」。
 *
 * **旁证**：雒城的搭档 **吴兰**（同为刘璋部将 → 降刘备 → 下辨战死）在数据里就是
 * **一条记录横跨两阶段**（雒城期的 `wu-yi→保荐`、`huang-zhong→对战`；
 * 下辨期的 `ma-chao→主将部将`）—— 同类人物怎么建，就是最省力的对照标准。
 *
 * 合并动作：主名去掉括号后缀（照 v0.121 毌丘俭先例）改回「雷同」；
 * `firstCh` 64 → 62（第 62 回才是实打实出场）；`张飞 → 主将与部将` 那条边改挂同一 id；
 * 别名只留「雷铜」（`aliases` 里等于主名的「雷同」会被 validate 判为不卫生，删）。
 *
 * ⚠ 这是一次**推翻既有文档判断**的改动。依据是**同一份原著**的逐条通读；
 *   若另有印本依据证明是两人，`git revert` 即可。
 *
 * ## 二、6 人的 firstCh / faction
 *
 * 这 6 人的 `note` 原本明写「⚠ firstCh 未填 —— 按名字首次出现自动换算不可靠…不写错的」
 * ⇒ 是**故意留空**，不是漏填。所以本脚本的每条 `firstCh` 都带一个
 * **原著定位短语**（必须逐字存在，否则拒绝写入），不是"名字首现换算"。
 *
 *   `faction` 按**同类人物**的既有惯例补（不另起一套）：
 *     荆南太守（对齐韩玄/金旋）= qunxiong · 杨陵=wei（对齐族兄杨阜）
 *     徐氏=wu（对齐孙翊）· 张皇后=wei（对齐曹芳）
 *
 * ⚠ 改 `firstCh` 必须**同步改写 `note`**（原 note 写着"未填"），否则 note 与新值自相矛盾。
 *
 * 用法：node scripts/fix-merge-leitong.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');
const SRC = path.join(os.tmpdir(), 'opencode', 'ba-books', '三国演义.txt');

if (!fs.existsSync(SRC)) { console.error(`✗ 找不到原著文本：${SRC}`); process.exit(1); }
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');
const f = flat(fs.readFileSync(SRC, 'utf8'));

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(book.characters.map((c) => [c.id, c]));
const nm = (id) => byId.get(id)?.name ?? id;

/* ══════════════ 一、合并雷同（雒城）+ 雷同（巴西）══════════════ */
console.log('═══ 一、合并「雷同（雒城）」与「雷同（巴西）」—— 同一人 ═══\n');
let merged = false;
{
  const KEEP = 'lei-tong', DROP = 'lei-tong-basi';
  /* 定位短语：必须在原文里逐字存在，否则拒绝合并 */
  const P = [
    '吴懿保吴兰、雷同二人为副将',
    '吴兰、雷同料敌不住，只得将本部军马前来投降',
    '时张飞自与雷同守把巴西',
    '张郃复回，刺雷同于马下',
  ];
  let ok = true;
  for (const p of P) { const hit = f.includes(flat(p)); console.log(`  原文核验：「${p}」→ ${hit}`); if (!hit) ok = false; }
  if (!ok) { console.error('  ⛔ 定位短语核验不过 —— 拒绝合并'); process.exitCode = 1; }
  else if (!byId.has(KEEP)) { console.error(`  ⛔ 找不到 ${KEEP}`); process.exitCode = 1; }
  else if (!byId.has(DROP)) {
    console.log(`\n  (跳过) ${DROP} 不存在 ⇒ 合并**已应用**。`);
    const c = byId.get(KEEP);
    console.log(`  现状：${c.name}　firstCh=${c.firstCh}　faction=${c.faction}　title=${c.title}`);
    console.log(`        aliases=${JSON.stringify(c.aliases)}　deg=${book.relations.filter((r) => r.from === KEEP || r.to === KEEP).length}`);
  } else {
    const a = byId.get(KEEP), b = byId.get(DROP);
    console.log('\n  合并前：');
    console.log(`    ${a.name}　firstCh=${a.firstCh}　title=${a.title}　desc=${a.desc}`);
    console.log(`    ${b.name}　firstCh=${b.firstCh ?? '(缺)'}　title=${b.title}　desc=${b.desc}`);

    let moved = 0;
    for (const r of book.relations) {
      if (r.from === DROP) { r.from = KEEP; moved++; }
      if (r.to === DROP) { r.to = KEEP; moved++; }
    }
    a.name = '雷同';
    a.aliases = ['雷铜'];                       // 去掉等于主名的「雷同」
    a.firstCh = 62;
    a.title = '川将→张飞部将';                    // 多阶段用 title（照刘虞「幽州牧→太尉」）
    a.desc = '刘璋部将，与吴兰同为吴懿所保的副将，屯雒城。';   // desc 口径 = firstCh 那回的简介
    a.fate = '随张飞守巴西，中张郃埋伏，被刺于马下。';
    a.note = '⚠ v0.159 合并了被误拆的「雷同（巴西）」：原著只有一个雷同——第62回吴懿保其为副将赴雒城 → 第64/65回随刘璋降刘备 → 第69回「张飞自与雷同守把巴西」→ 第70回被张郃刺于马下。判据与教训见 docs/新书处理规程.md §2.7。';
    book.characters = book.characters.filter((c) => c.id !== DROP);
    byId.delete(DROP);
    console.log(`\n  端点迁移 ${moved} 处；删除 id=${DROP}；人物数 ${book.characters.length}`);
    merged = true;
  }
}

/* ══════════════ 二、6 人补 firstCh / faction ══════════════ */
console.log('\n═══ 二、6 人补 firstCh / faction（每条带原著定位短语）═══\n');

/**
 * [id, firstCh, faction, 定位短语（必须逐字存在）, note 里 firstCh 那一句]
 * ⚠ 定位短语全部取自**原著**，不是事件 summary（v0.123 踩过这个坑）。
 */
const FILL = [
  ['xu-shi', 38, 'wu', '翊妻徐氏美而慧，极善卜《易》',
    'firstCh=38 —— 原著里该名字**仅见于第 38 回**（卜卦劝翊勿出、后智杀妫览戴员）。'],
  ['zhao-fan', 52, 'qunxiong', '早有探马报知桂阳太守赵范',
    'firstCh=52 —— 原著里该名字**仅见于第 52 回**（赵云取桂阳，赵范当回出场议事）。'],
  ['chen-ying', 52, 'qunxiong', '管军校尉陈应、鲍隆愿领兵出战',
    'firstCh=52 —— 原著里该名字**仅见于第 52 回**（与鲍隆同回出场、后诈降赵云）。'],
  ['bao-long', 52, 'qunxiong', '管军校尉陈应、鲍隆愿领兵出战',
    'firstCh=52 —— 原著里该名字**仅见于第 52 回**（与陈应同回出场、后诈降赵云）。'],
  ['yang-ling-nan', 92, 'wei', '此人乃杨阜之族弟杨陵也',
    'firstCh=92 —— 第 92 回内出现 12 次（崔谅先提及、孔明遣其说降、杨陵献城被关兴斩）；首现处是被提及，但实打实出场也在第 92 回。'],
  ['zhang-huanghou', 109, 'wei', '缉乃张皇后之父，曹芳之皇丈也',
    'firstCh=109 —— 第 109 回内出现 3 次（先被提及，后与曹芳密室商议、被司马师绞死）。'],
];

let added = 0, skipped = 0, failed = 0;
for (const [id, firstCh, faction, cite, noteTail] of FILL) {
  const c = byId.get(id);
  if (!c) { console.log(`  ⛔ 找不到 ${id}`); failed++; continue; }
  if (!f.includes(flat(cite))) { console.error(`  ⛔ ${nm(id)}：定位短语「${cite}」原文里没有 —— 拒绝写入`); failed++; continue; }
  if (Number.isFinite(Number(c.firstCh)) && c.faction) { console.log(`  (跳过) ${nm(id)} 已有 firstCh=${c.firstCh} / faction=${c.faction}`); skipped++; continue; }
  c.firstCh = firstCh;
  c.faction = faction;
  c.note = String(c.note || '').replace(/。⚠ firstCh 未填[\s\S]*$/, '。' + noteTail);
  console.log(`  ＋ ${nm(id).padEnd(8)} firstCh=${firstCh}　faction=${faction}`);
  console.log(`      原文依据：「${cite}」`);
  added++;
}

/* ══════════════ 三、体检 ══════════════ */
console.log('\n═══ 三、体检 ═══\n');
{
  const noFc = book.characters.filter((c) => !Number.isFinite(Number(c.firstCh)));
  const noFac = book.characters.filter((c) => !c.faction);
  console.log(`  缺 firstCh：${noFc.length} 人${noFc.length ? `（${noFc.map((c) => c.name).join('、')}）` : ''}`);
  console.log(`  缺 faction：${noFac.length} 人${noFac.length ? `（${noFac.map((c) => c.name).join('、')}）` : ''}`);
  if (noFc.length || noFac.length) process.exitCode = 1;

  const dup = book.characters.filter((c) => c.id === 'lei-tong-basi');
  console.log(dup.length ? '  ✗ 「雷同（巴西）」还在' : '  ✓ 「雷同（巴西）」已并入「雷同」');
  if (dup.length) process.exitCode = 1;

  const lt = byId.get('lei-tong');
  console.log(`  雷同：name=${lt?.name}　aliases=${JSON.stringify(lt?.aliases)}　firstCh=${lt?.firstCh}　deg=${book.relations.filter((r) => r.from === 'lei-tong' || r.to === 'lei-tong').length}`);

  const clash = book.characters.filter((c) => (c.aliases || []).includes(c.name));
  console.log(clash.length ? `  ✗ 别名撞本名：${clash.map((c) => c.name).join('、')}` : '  ✓ 没有别名撞本名');
  if (clash.length) process.exitCode = 1;
}

console.log(`\n本轮：合并 ${merged ? '1 组（删 1 个 id）' : '0 组（已应用）'}；补 firstCh/faction ${added} 人（跳过 ${skipped}，失败 ${failed}）`);
console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2).replace(/\n/g, '\r\n') + '\r\n', 'utf8');
