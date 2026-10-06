/**
 * 找《三国演义》里"有台词、但数据里没有"的人物。
 *
 * ## 两次收紧的过程（都是被自己的产出打回来的）
 *
 * v1：用 `/(.{1,4}?)(笑|怒|…)?曰/`，**6876 个候选**。
 *     问题：`.{1,4}?` 是惰性匹配，从扫描位置往后凑 1~4 个字符再接 曰，
 *     抓到的根本不是名字，是 曰 前面的任意 4 个字。
 *
 * v2（这一版）：**锚定姓氏 + 长度 + 频次**三条同时满足
 *     · X 以姓氏字开头（姓氏表来自数据里已有的 868 个人物 ＋ 百家姓常见字）
 *     · X 长 2~3 字
 *     · X 在原文里出现 ≥ MIN_FREQ 次（真人物会反复出现，偶然一次的不算）
 *     · 排除「众曰/左右曰/百姓曰」这类非人主语
 *
 * ⚠ 仍然是**候选**，不是判定。落盘前每一条都要回原文看那一句在不在写这个人。
 *
 * 用法：node scripts/find-missing-people.mjs [--min=3]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_FREQ = Number((process.argv.find((a) => a.startsWith('--min=')) || '').slice(6) || 3);
const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'three-kingdoms.json'), 'utf8'));
const src = fs.readFileSync('C:/Users/chw/AppData/Local/Temp/opencode/ba-books/三国演义.txt', 'utf8');
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');
const f = flat(src);
const toRaw = (i) => {
  let raw = 0, seen = 0;
  for (let j = 0; j < src.length; j++) {
    if (seen >= i) { raw = j; break; }
    if (!/[\s·・･　]/.test(src[j])) seen++;
  }
  return raw;
};

/* 已知名字 */
const known = new Set();
for (const c of book.characters) {
  known.add(flat(c.name));
  for (const a of [...(c.aliases ?? []), ...(c.altNames ?? [])]) known.add(flat(a));
}

/* 姓氏表：数据里已有的人物名首字 ＋ 百家姓常见字 */
const BAIJIA = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廉贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const surn = new Set();
for (const c of book.characters) {
  const n = flat(c.name);
  for (const L of [1, 2]) { const s = n.slice(0, L); if (s.length === L) surn.add(s); }
}
for (const ch of BAIJIA) surn.add(ch);

/* 非人主语 */
const NOT_PERSON = /^(众|左右|众军|诸|诸人|百姓|军民|众人|父子|兄弟|夫妻|陛下|主公|某|吾|汝|尔|彼|这|那|众将|将士|军士|部下|帐下|麾下|众官|百官|群臣|文武|诸将|先主|后主|众人|四众|三众|二众|曹众|吴众|蜀众|魏众)/;

/**
 * 统计所有「X曰」里 X 的原始写法。
 *
 * ⚠ v2 忘了剥掉 X 尾部的**情绪/动作动词**，于是产出里混着两类东西：
 *   · 「孔明笑曰」「张飞大怒曰」—— 名字是**孔明**／**张飞**，只是粘着动词。
 *     这是**别名缺口**，该补 aliases，不是新建人物。
 *   · 「大喜曰」「大叫曰」「大呼曰」—— 整个 X 都是动词，纯噪声。
 *   所以先把尾部动词剥掉：剥完为空 ⇒ 噪声；剥完还在 ⇒ 可能是名字。
 */
const TAIL_VERB = /(笑|怒|惊|喜|叹|问|喝|叱|呼|叫|拍|顿|抚|指|答|回|冷|仰|大笑|大怒|大惊|大叫|大呼|大哭|大喝|高叫|怒|喜|笑|曰)$/;
const tally = new Map();   // X -> {n, first}
const SAY = /([一-鿿]{2,4})(笑|怒|惊|喜|叹|问|喝|叱|呼|叫|拍|顿|抚|指|答|回|冷|仰|大)?曰/g;
let m;
while ((m = SAY.exec(f))) {
  let who = m[1];
  /* 剥尾部动词，最多剥两轮（"张飞大怒" → "张飞"） */
  for (let k = 0; k < 2; k++) {
    const s = who.replace(TAIL_VERB, '');
    if (s === who) break;
    who = s;
  }
  if (who.length < 2 || who.length > 3) continue;
  if (NOT_PERSON.test(who)) continue;
  if (known.has(who)) continue;
  const t = tally.get(who) ?? { n: 0, first: m.index };
  t.n++;
  tally.set(who, t);
}

const cands = [];
for (const [who, t] of tally) {
  if (known.has(who)) continue;
  if (!surn.has(who[0])) continue;                       // ① 以姓氏字开头
  const freq = f.split(who).length - 1;
  if (freq < MIN_FREQ) continue;                          // ② 全文出现 ≥ MIN_FREQ 次
  cands.push({ who, saidTimes: t.n, freq, at: t.first });
}
cands.sort((a, b) => b.freq - a.freq || a.who.localeCompare(b.who));

console.log(`《三国演义》人物 ${book.characters.length} 人，已知名字 ${known.size} 条`);
console.log(`「X曰」出现过的写法 ${tally.size} 个，过滤后候选 ${cands.length} 个`);
console.log(`（筛选条件：X 以姓氏字开头、长度 2~3、原文出现 ≥ ${MIN_FREQ} 次、不在已知名字里）\n`);
for (const c of cands) {
  const raw = toRaw(c.at);
  console.log(`  ${c.who.padEnd(4)}  曰×${String(c.saidTimes).padStart(3)}  全文×${String(c.freq).padStart(3)}   …${src.slice(Math.max(0, raw - 46), raw + 66).replace(/\r?\n/g, '·')}…`);
}
console.log(`\n⚠ 全是**候选**。落盘前逐条回原文确认。`);
console.log(`  常见假阳性：单字简称漏了 aliases（该补别名不该建人物）、复姓被截断（如"司马"）、`);
console.log(`  官职代称（如"黄巾"）。`);
