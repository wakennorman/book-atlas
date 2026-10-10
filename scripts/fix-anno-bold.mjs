#!/usr/bin/env node
/**
 * v0.175：修掉拆书数据里**落单的配对记号**（`**` 出现奇数次）。
 *
 * ## 为什么
 * `scripts/audit-annotations.mjs` 的 B1 一直在报「粗体标记不闭合：1 处」。
 * 这**不是"少加粗一点"**这么轻 —— `annoBody()` 里那条加粗正则
 * （把星号对之间的内容换成 `<strong>`）是**从左往右按顺序配对**的，
 * 落单的那个记号会把**后面所有的配对整体错位一格**。实测后果（罪与罚 ch29）：
 *   · 第 1 对：从落单处到下一个记号 —— 把 168 字的叙述句整段加粗
 *     （而该文件加粗片段中位 18 字、p90 35 字 ⇒ 远超惯例）
 *   · 第 2、3 对：本来该加粗的三个结论句全错位，加粗到了别的句子（含 id 引用）
 *   · 段末那个记号**没得配**，以字面的 `**` 直接显示给读者
 *
 * ## 判据：为什么是"删掉落单的那个"，而不是"补一个闭合"
 * 逐条读过该段之后定的（不是从机制推的）：
 *   记号 #2..#7 已经构成三对**完整自洽的结论句** ——
 *   「索尼雅自己翻口袋和被卡捷莉娜硬扯口袋，是两个完全不同的场景」
 *   「把纸抖出来」「这一章的题目可以叫『抖出来』——而那张纸在口袋里躺了整整一章。」
 *   #2 必须是**开**（它和 #3 之间的内容是一句自足的判断句），#3 必须是**闭**；
 *   #4/#5、#6/#7 同理。⇒ 只有 #1 落单，且它后面没有任何短片段可以当它的闭合对象。
 *   另外实测该文件 107 个 ≤14 字的加粗片段，全是**判断句**（「他是全章的结论句」
 *   「他把自己也放进了那张账里」），**没有**"把叙述证据整段加粗"这种写法 ⇒
 *   #1 是**误开的记号**，不是漏写的闭合。补闭合会让 168 字叙述句被加粗，与惯例相反。
 *
 * ## 为什么走脚本而不是手改
 * 同 `fix-anno-en.mjs`：罪与罚是 CRLF、缩进不是 `JSON.stringify(x,null,2)`
 * （数组元素只缩进 2 格）⇒ `parse → 序列化` 会整文件重写，diff 全是噪声。
 * 所以**解析出来算，落盘用「整值字面替换」**，写完 parse 回来**深比对**。
 *
 * ## 断言（不满足就拒绝写盘）
 *   ① `locate` 短语必须在文件里**逐字出现且只出现一次**（找不到 = 我记错了，停下）。
 *   ② 落盘后深比对通过。
 *   ③ 全库三个文件的 `title`/`body`/`basis` 里，**配对记号必须全部成对**
 *      —— 判据与 `scripts/check-annotations.mjs` 规则⑧**同源**，不另抄一份口径。
 *
 * 用法：
 *   node scripts/fix-anno-bold.mjs           # 只预览（默认）
 *   node scripts/fix-anno-bold.mjs --write   # 落盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANNO_DIR = path.join(ROOT, 'data', 'annotations');
const WRITE = process.argv.includes('--write');

/* ---------- 要修的：每条 [书, 章, 字段, 定位短语(改前), 改后, 为什么] ---------- */
const FIXES = [
  {
    slug: 'crime-and-punishment',
    ch: 29,
    field: 'body',
    locate: '（e62）**索尼雅自己伸手翻口袋，但',
    to: '（e62）索尼雅自己伸手翻口袋，但',
    why: '落单的 ** —— 删掉它（判据见文件头：该段 #2..#7 已构成三对自洽的结论句，'
      + '只有 #1 落单；且本文件没有"把叙述证据整段加粗"的写法）。',
  },
];

/* ---------- 判据：与 check-annotations.mjs 规则⑧同源 ---------- */
const MARKUP_PAIRS = [['**', '**'], ['「', '」'], ['『', '』'], ['（', '）'], ['《', '》']];
function unbalancedMarkup(text) {
  const s = String(text);
  const out = [];
  for (const [o, c] of MARKUP_PAIRS) {
    const no = s.split(o).length - 1;
    if (o === c) {
      if (no % 2) out.push(`${o} × ${no}（奇数）`);
      continue;
    }
    const nc = s.split(c).length - 1;
    if (no !== nc) out.push(`${o}${c} ${no} vs ${nc}`);
  }
  return out;
}

/* ---------- 走一遍 ---------- */
const byFile = new Map(); // f → { p, raw, j, plans:[{group,it,k,oldV,newV,why}] }
let already = 0;

for (const fx of FIXES) {
  const f = `${fx.slug}.json`;
  const p = path.join(ANNO_DIR, f);
  const raw = fs.readFileSync(p, 'utf8');

  /* ① 定位短语必须**逐字出现且只出现一次**（跨整个文件，不只看某个字段） */
  const hits = raw.split(fx.locate).length - 1;
  const alreadyHits = fx.to === fx.locate ? 0 : raw.split(fx.to).length - 1;
  if (hits !== 1) {
    if (hits === 0 && alreadyHits >= 1) { already++; continue; } // 跑过了
    console.error(`✗ ${f}：定位短语出现 ${hits} 次（要求恰好 1 次）—— 我记错了，停下：\n   ${JSON.stringify(fx.locate)}`);
    process.exit(1);
  }

  const j = JSON.parse(raw);
  let found = null;
  for (const [group, arr] of [['items', j.items], ['global', j.global]]) {
    for (const it of arr || []) {
      if (it.ch !== fx.ch) continue;
      if (typeof it[fx.field] !== 'string') continue;
      if (!it[fx.field].includes(fx.locate)) continue;
      found = { group, it, k: fx.field, oldV: it[fx.field], newV: it[fx.field].split(fx.locate).join(fx.to) };
    }
  }
  if (!found) {
    console.error(`✗ ${f}：定位短语在文件里找得到，却没有落在 ch=${fx.ch} 的 .${fx.field} 上 —— 停下`);
    process.exit(1);
  }
  const e = byFile.get(f) || { p, raw, j, plans: [] };
  e.plans.push({ ...found, why: fx.why });
  byFile.set(f, e);
}

if (!byFile.size) {
  console.log(`无需改动${already ? `（${already} 条已经是新值 —— 看起来跑过了）` : ''}。`);
} else {
  for (const [f, { p, raw, j, plans }] of byFile) {
    /* ④ 落盘用「整值字面替换」——保住行尾与缩进 */
    let out = raw;
    for (const { oldV, newV } of plans) {
      const key = JSON.stringify(oldV);
      const cnt = out.split(key).length - 1;
      if (cnt < 1) {
        console.error(`\n✗ ${f} 里找不到这个原值（说明文件不是我读到的样子，停下）：\n   ${key.slice(0, 140)}…`);
        process.exit(1);
      }
      out = out.split(key).join(JSON.stringify(newV));
    }

    /* ⑤ 深比对：先把 j 改成预期态，再拿 out 解析回来比 */
    for (const { it, k, newV } of plans) it[k] = newV;
    const got = JSON.parse(out);
    if (JSON.stringify(got) !== JSON.stringify(j)) {
      console.error(`\n✗ ${f} 落盘后深比对不一致 —— 不写盘（不留半成品）`);
      process.exit(1);
    }

    console.log(`${WRITE ? '已写入' : '预览（未写盘）'} ${f}：${plans.length} 处`);
    for (const { group, it, k, why } of plans) {
      console.log(`  · ${group} ch=${it.ch} .${k}\n    ${why}`);
    }
    if (WRITE) fs.writeFileSync(p, out, 'utf8');
  }
}

/* ③ 收口断言：全库配对记号必须全部成对（判据与门禁规则⑧同源）
 *  ⚠ 预览模式（不写盘）下**不能**拿磁盘上的旧内容来判 —— 那必然还是红的。
 *    预览时判「预期态的内存对象」；写盘后判「磁盘上的真内容」（更强的口径）。 */
let bad = 0;
for (const f of fs.readdirSync(ANNO_DIR).filter((x) => x.endsWith('.json')).sort()) {
  const inMem = byFile.get(f);
  const j = WRITE || !inMem ? JSON.parse(fs.readFileSync(path.join(ANNO_DIR, f), 'utf8')) : inMem.j;
  for (const [group, arr] of [['items', j.items], ['global', j.global]]) {
    (arr || []).forEach((it, i) => {
      for (const k of ['title', 'body', 'basis']) {
        if (typeof it[k] !== 'string') continue;
        const u = unbalancedMarkup(it[k]);
        if (u.length) { bad++; console.error(`✗ ${f} ${group}[${i}] ch=${it.ch} .${k}：${u.join('；')}`); }
      }
    });
  }
}
if (bad) {
  console.error(`\n✗ 收口断言未过：仍有 ${bad} 处配对记号不成对${WRITE ? '（文件已写盘，需再修）' : ''}`);
  process.exit(1);
}
console.log(`\n✓ 全库配对记号全部成对（title/body/basis，3 本书）${WRITE ? '' : '（按预期态判，尚未写盘）'}`);
if (!WRITE && byFile.size) console.log('加 --write 落盘。');
