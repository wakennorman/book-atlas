#!/usr/bin/env node
/**
 * v0.117：修两组同音/近形人名 —— 一组是我刚造的重名，一组是数据里早就有的错边
 *
 * ## 一、朱儁 vs 朱隽：**同一人**，我 v0.116 造了个重名
 *
 *   群英谱：「朱儁　字**公伟**，会稽郡人…曾平定交州叛乱，**讨伐黄巾**」
 *   正文　：「一面遣中郎将卢植、皇甫嵩、**朱隽**（读如俊）各引精兵分三路讨之」
 *
 * 数据里原有的 朱儁（别名 公伟，desc「与皇甫嵩共讨颍川黄巾」）就是这一位 ——
 * desc 全是正文材料，只有「公伟」出自群英谱。
 * 我 v0.116 搜「X曰」时只认得「朱隽」，没发现已经有人了。
 *
 * ⇒ 删掉我新建的 朱隽，把 **朱儁 改名为 朱隽**（用户定的口径：
 *   「人名一律按用户发过来的那本书的版本确定」—— 正文用「朱隽」，28 次；
 *   「朱儁」只在群英谱里出现 1 次）。
 *   别名保留 `朱儁`、`公伟`，并在 note 里注明「公伟」出自群英谱而非正文。
 *
 * ★ 这是孙河/孙和那一类错误的**反方向**：上次是把两个人并成一个，这次是把一个人当成两个。
 *   同一个根因 —— **只按名字匹配，不查已有数据里有没有同一个人**。
 *
 * ## 二、杨陵 vs 杨龄：**两个人**，但数据里有一条早就错了的边
 *
 *   杨陵　南安太守，13 次 ——「此人乃杨阜之族弟**杨陵**也」（孔明/崔谅那条线）
 *   杨龄　韩玄麾下管军校尉，6 次 ——「乃管军校尉**杨龄**」，被关羽斩（长沙线）
 *
 * 数据里这两条边的 `to` 指向**杨龄**，而**事件文案写的全是杨陵**：
 *     杨阜  —族兄弟— 杨龄   「崔谅称南安太守杨陵乃杨阜之族弟。」
 *     崔谅  —交厚好友— 杨龄  「崔谅自言与南安太守杨陵交契甚厚。」
 * ⇒ 数据自己就矛盾。`check-kin-terms` 查不到，因为「族兄弟」不是亲子边类型。
 *   修法：`to` 改指杨陵。杨龄修完没有关系了（原文本里它只有韩玄部将这一个身份，
 *   而那条边数据里本来就没有 —— 那是另一处缺口，本次不补）。
 *
 * ## 三、给刘繇 / 朱隽 / 杨陵 补原文写明的关系
 *
 * 刘繇（全部有原文）：
 *     「刘繇字正礼…亦为汉室宗亲，**太尉刘宠之侄**，**兖州刺史刘岱之弟**」
 *         ⇒ 刘岱 是 刘繇 的兄长 ⇒ `刘岱 —兄弟— 刘繇`
 *     「商议攻击刘繇」「刘繇自引大军，杀下岭来」「刘繇一千余军和程普等十二骑混战」
 *         ⇒ `孙策 —敌对— 刘繇`
 *     「旧为扬州刺史…**被袁术赶过江东**」
 *         ⇒ `袁术 —敌对— 刘繇`
 *     「慈自解了北海之围后，便来见刘繇，**繇留于帐下**」「遂**不候刘繇将令**」
 *         ⇒ `刘繇 —主将部将— 太史慈`
 *     「太尉刘宠之侄」—— 刘宠 在数据里没有，且「侄」既可能是侄女之子也可能是兄弟之子，
 *         **不确定就不连**。
 *
 * 朱隽：
 *     「一面遣中郎将卢植、皇甫嵩、朱隽各引精兵分三路讨之」⇒ 与卢植、皇甫嵩分三路 ⇒ 同僚
 *     「太仆朱隽**保举**一人，可破群贼」＋「朱隽曰：'要破山东群贼，**非曹孟德不可**'」
 *         ⇒ `朱隽 —举荐— 曹操`（"举荐"这个 type 数据里已有 7 条）
 *
 * 用法：node scripts/fix-name-clashes.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byName = new Map(book.characters.map((c) => [c.name, c]));
const byId = new Map(book.characters.map((c) => [c.id, c]));
const nm = (id) => byId.get(id)?.name ?? id;

/* ── 一、朱儁 与我造的重名 朱隽 合并 ── */
console.log('=== 一、朱儁 / 朱隽：同一人，合并 ===');
{
  const real = byId.get('zhu-jun');
  const dup = byId.get('zhu-jun-han');
  if (!real) console.log('  ⛔ 数据里没有 zhu-jun');
  else if (!dup) console.log('  (跳过) 没有重复的 zhu-jun-han（可能已合并过）');
  else {
    console.log(`  重复项：${dup.name}（${dup.id}）`);
    /* 重复项身上的边先确认有没有非空字符串再搬 —— 目前它一条边都没有 */
    const dupEdges = book.relations.filter((r) => r.from === dup.id || r.to === dup.id);
    console.log(`  重复项身上的边 ${dupEdges.length} 条${dupEdges.length ? '（需要搬，见下）' : '（无，直接删）'}`);
    for (const e of dupEdges) {
      const other = e.from === dup.id ? e.to : e.from;
      console.log(`    搬：${nm(dup.id)} —${e.type}— ${nm(other)}  ⇒  ${nm(real.id)} —${e.type}— ${nm(other)}`);
      if (e.from === dup.id) e.from = real.id; else e.to = real.id;
    }
    book.characters = book.characters.filter((c) => c.id !== dup.id);
    byName.delete('朱隽');
    byId.delete(dup.id);
    console.log(`  已删重复人物 ${dup.name}`);
  }
  const zj = byId.get('zhu-jun');
  if (zj) {
    console.log(`\n  ${zj.name} → 朱隽（用户口径：人名按那本书的版本；正文写「朱隽」28 次，`
      + `「朱儁」只在群英谱出现 1 次）`);
    byName.delete(zj.name);
    zj.name = '朱隽';
    byName.set('朱隽', zj);
    zj.aliases = [...new Set([...(zj.aliases ?? []), '朱儁', '公伟', '隽', '朱俊'])];
    const tip = '⚠「公伟」与「会稽郡人」出自卷末《三国群英谱》，**正文未写**；'
      + '正文一律作「朱隽（读如俊）」。v0.117 合并了 v0.116 误建的同一人。';
    zj.note = zj.note ? `${zj.note}　${tip}` : tip;
    console.log(`  别名：${JSON.stringify(zj.aliases)}`);
  }
}

/* ── 二、杨龄 → 杨陵：把两条边的 to 改回来 ── */
console.log('\n=== 二、杨陵 / 杨龄：数据里两条边的 to 指错了人 ===');
{
  const yl = byName.get('杨陵');       // 我 v0.116 新建的（对的那个）
  const wrong = byName.get('杨龄');    // 原有指向的那个
  if (!yl || !wrong) { console.log('  ⛔ 杨陵 或 杨龄 不存在，请人工核对'); }
  else {
    let fixed = 0;
    for (const r of book.relations) {
      if (r.from !== wrong.id && r.to !== wrong.id) continue;
      /* 只改那些文案里明写「杨陵」的边 —— 文案是判据，不是猜 */
      const text = (r.events ?? []).map((e) => e.text || '').join('');
      if (!text.includes('杨陵')) continue;
      console.log(`  ${nm(r.from)} —${r.type}— ${nm(r.to)}   ← 文案说「杨陵」`);
      if (r.to === wrong.id) r.to = yl.id; else r.from = yl.id;
      console.log(`      改为 ${nm(r.from)} —${r.type}— ${nm(r.to)}`);
      fixed++;
    }
    if (!fixed) console.log('  (跳过) 没找到文案写「杨陵」却指向杨龄的边');
    const left = book.relations.filter((r) => r.from === wrong.id || r.to === wrong.id);
    console.log(`  修了 ${fixed} 条；杨龄 现有关系 ${left.length} 条`);
    if (!left.length) console.log('  ⚠ 杨龄 变成孤立点 —— 原著里他是韩玄麾下管军校尉（被关羽斩），'
      + '那条边数据里本来就没有，属另一处缺口，本次不补。');
  }
}

/* ── 三、补原文写明的关系 ── */
console.log('\n=== 三、补刘繇 / 朱隽 / 杨陵 的关系 ===');
/** [from名, type, to名, 文案, 定位短语] */
const EDGES = [
  ['刘岱', '兄弟', '刘繇', '刘繇是兖州刺史刘岱之弟，兄长。', '兖州刺史刘岱之弟'],
  ['孙策', '敌对', '刘繇', '张昭张纮商议攻击刘繇；两军会于牛渚滩上、神亭岭下交战。', '商议攻击刘繇'],
  ['袁术', '敌对', '刘繇', '刘繇旧为扬州刺史，屯于寿春，被袁术赶过江东，遂屯曲阿。', '被袁术赶过江东'],
  ['刘繇', '主将部将', '太史慈', '太史慈来见刘繇，繇留于帐下；后慈不候刘繇将令，自出为前部先锋。', '繇留于帐下'],
  ['朱隽', '同僚', '卢植', '何进遣中郎将卢植、皇甫嵩、朱隽各引精兵分三路讨黄巾。', '卢植、皇甫嵩、朱隽'],
  /* 杨龄：我把两条边的 to 从杨龄改到杨陵之后，杨龄就成孤立点了（0 条关系）。
   * 原文里他是韩玄麾下管军校尉、被关羽斩 —— 补回去，别留一个无来历的点。
   * 「韩玄视之，乃管军校尉杨龄。韩玄大喜，遂令杨龄引军一千」 */
  ['韩玄', '主将部将', '杨龄', '管军校尉杨龄、韩玄部将，奉命引军一千出城迎战关羽，为关羽所斩。', '乃管军校尉杨龄'],
];

const SRC = 'C:/Users/chw/AppData/Local/Temp/opencode/ba-books/三国演义.txt';
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');
const f = flat(fs.readFileSync(SRC, 'utf8'));

/* 回次表：正文从「第X回」第二次出现开始（第一次是目录） */
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100, 零: 0 };
const cn2num = (s) => {
  if (s.length === 1) return CN[s] ?? null;
  let t = 0, cur = 0;
  for (const ch of s) {
    const v = CN[ch];
    if (v == null) return null;
    if (v === 100) { cur = (cur || 1) * 100; t += cur; cur = 0; }
    else if (v === 10) { cur = (cur || 1) * 10; t += cur; cur = 0; }
    else cur = v;
  }
  return t + cur || null;
};
const firstAt = [];
{ const re0 = /第([一二三四五六七八九十百零]+)回/g; let m0; while ((m0 = re0.exec(f))) { if (cn2num(m0[1]) === 1) firstAt.push(m0.index); if (firstAt.length >= 2) break; } }
const CH = []; const seen = new Set();
const re = new RegExp('第([一二三四五六七八九十百零]+)回', 'g');
re.lastIndex = firstAt[1] ?? 0;
let m; while ((m = re.exec(f))) { const n = cn2num(m[1]); if (!n || seen.has(n)) continue; seen.add(n); CH.push({ n, at: m.index }); }
const chOf = (phrase) => {
  const i = f.indexOf(flat(phrase));
  if (i < 0) return null;
  let lo = 1, hi = CH.length, best = 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (CH[mid - 1].at <= i) { best = CH[mid - 1].n; lo = mid + 1; } else hi = mid - 1; }
  return best;
};

let added = 0, dup = 0, miss = 0;
for (const [a, type, b, text, locate] of EDGES) {
  const ca = byName.get(a), cb = byName.get(b);
  if (!ca || !cb) { console.log(`  ⛔ 找不到 ${!ca ? a : b}`); miss++; continue; }
  if (book.relations.some((r) => (r.from === ca.id && r.to === cb.id) || (r.from === cb.id && r.to === ca.id))) {
    console.log(`  (跳过) ${a} × ${b} 已有关系`); dup++; continue;
  }
  if (!f.includes(flat(locate))) { console.log(`  ⛔ ${a}—${b}：定位短语「${locate}」原文里没有`); miss++; continue; }
  const ch = chOf(locate);
  book.relations.push({
    from: ca.id, to: cb.id, type,
    kin: /兄弟|族/.test(type) ? 'blood' : 'sworn',
    style: /敌对/.test(type) ? 'dashed' : 'solid',
    fromCh: ch, toCh: ch + 1,
    events: [{ chapter: ch, text, evidence: 'paraphrase' }],
  });
  console.log(`  ＋ ${a} —${type}— ${b}　第 ${ch} 回：${text}`);
  added++;
}
console.log(`\n补关系 ${added} 条（已有 ${dup}、缺依赖 ${miss}）`);
console.log('⚠ 「太尉刘宠之侄」这条**没连** —— 刘宠 不在数据里，且「侄」既可指侄女之子');
console.log('   也可指兄弟之子，原著没说是哪种，不确定就不连。');

console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
