/**
 * 修掉 verify-quotes.mjs 报出的**确定缺陷**：原文里不存在的引号。
 *
 * 当前只处理 1 条（v0.104）：
 *   「尼古拉·杰缅季耶夫在人群里喊出「是我杀的」，把波尔菲利精心布下的局搅乱了。」
 * 查证过程（scripts/verify-quotes.mjs 报的 negated 类）：
 *   · 本译本全文只有两处「是我杀」：
 *       ① 拉斯柯尔尼科夫无意中说的「如果老太婆和丽扎维达就是我杀死的，那怎么样？」
 *       ② 他否认的「不是我杀的。」
 *   · 杰缅季耶夫这个名字只出现 2 次（人物表 + 杜希金转述），
 *     搜 6 个译名变体（杰米扬耶夫/捷米扬耶夫/扎缅耶夫/扎缅季耶夫/尼卡诺尔）**全不存在**。
 *   · 搜「打雷」「发了誓」**零命中** —— 这本源文本里没有酒馆认罪那一场的措辞。
 *   ⇒ 「是我杀的」这五个字在本译本里**不存在**，而且原文那句是**反话**。
 *
 * 处理原则：**不许猜一个别的引号替上去**（那就是第二次伪造）。
 * 只把引号去掉，保留事件本身（认罪搅局这个情节是真的），
 * 并在 note 里记下"引号内文字未能在本译本中核实"。
 *
 * 用法：node scripts/fix-bad-quotes.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'crime-and-punishment.json');

/** 精确到"必须完全一致"才动 —— 宁可漏改，不可错改。 */
const FIXES = [
  {
    slug: 'crime-and-punishment',
    find: '尼古拉·杰缅季耶夫在人群里喊出「是我杀的」，把波尔菲利精心布下的局搅乱了。',
    replace: '尼古拉·杰缅季耶夫当众认罪，把波尔菲利精心布下的局搅乱了。',
    note: '⚠ 原文案引号内的「是我杀的」在本译本里查不到：全文只有「如果老太婆和丽扎维达就是我杀死的」（拉斯柯尔尼科夫）和「不是我杀的」（他否认）。已去掉引号。引号内原措辞待换译本后复核。',
  },
];

let changed = 0;
for (const fx of FIXES) {
  const file = path.join(ROOT, 'data', `${fx.slug}.json`);
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.includes(fx.find)) { console.log(`  (跳过 ${fx.slug}) 找不到待修文案，可能已修过`); continue; }
  const book = JSON.parse(raw);
  let hit = 0;
  const walk = (arr) => {
    for (const e of arr ?? []) {
      if (e.text === fx.find) {
        e.text = fx.replace;
        e.evidence = 'paraphrase';
        e.note = fx.note;
        hit++;
      }
    }
  };
  for (const r of book.relations ?? []) walk(r.events);
  walk(book.events);
  console.log(`  ${fx.slug}：修 ${hit} 处文案`);
  changed += hit;
  if (WRITE && hit) fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
}
console.log(`\n合计改动 ${changed} 处${WRITE ? '（已写入）' : '（预览，加 --write 才落盘）'}`);
if (!changed && !WRITE) console.log('⚠ 一处都没改到，请核对 FIXES 里的 find 字符串是否仍与数据一致');
