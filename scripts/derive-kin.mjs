#!/usr/bin/env node
/**
 * 族谱补全：从**亲子边**推导出亲属关系，补成 `derived: true` 的关系。
 *
 * v0.103 重写。旧版只做到 3 代（曾祖孙）就停，于是《百年孤独》第 4 代以后
 * 祖先边全断 —— 梅梅有祖母、有祖父，却没有高祖母/高祖父。
 * 用户指出"从前几代开始关系线变少了"，查下来不是规则没起作用，是**只覆盖到第 3 代**。
 *
 * ## 补哪些、不补哪些（这是本脚本最要紧的决定）
 *
 *   ✅ 直系祖孙，**任意代差**        —— 是事实、可从族谱算出、读者也期待。零主观成分。
 *   ✅ 旁系差 1 代（叔侄/姑侄/舅甥）—— 密度高、代差小
 *   ✅ 同胞 / 堂表
 *   ❌ 旁系差 ≥2 代（叔祖父/姑侄孙…）
 *        **不补**。理由有二：
 *          ① 组合爆炸：每多一个后代，所有祖先的旁系边就翻一倍
 *             （《百年孤独》实测：补的话 60 对里 32 对是这类）
 *          ② 「高祖叔父与侄玄孙」这种标签对读者**零信息量**，
 *             却让图变成一团毛线
 *
 * ## 为什么称谓交给 kin-terms.mjs
 *
 * 旧版自己写 `label()` 判「伯叔侄」，于是：男性长辈一律叫"叔"、不分伯；
 * 第 4 代会拼出中文里不存在的「高祖孙」。
 * 现在统一由 scripts/kin-terms.mjs 算：上行/下行的辈分字第 4 代起分岔（高祖父 vs 玄孙），
 * 伯/叔按 `birthRank` 分，排行不详时写「伯叔」不硬猜。**双轨消除了。**
 *
 * ## 为什么手打的关系优先
 *
 * 「已有直接关系的两个人不再推导」这条**保留**，但它现在只挡"重复"，
 * 不再挡"纠错" —— 手打的错标签由 scripts/check-kin-terms.mjs 负责报出来。
 *
 * 用法：
 *   node scripts/derive-kin.mjs --all            # 预览
 *   node scripts/derive-kin.mjs --all --write
 *   node scripts/derive-kin.mjs data/xx.json --write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTree, computeKin, isParentChild } from './kin-terms.mjs';
import { listBooks } from './lib/data-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
/* ⚠ sidecar 名单从 scripts/lib/data-files.mjs 引，不再抄一份。 */
const files = argv.includes('--all')
  ? listBooks().map((x) => `data/${x}`)
  : argv.filter((a) => !a.startsWith('--'));

if (!files.length) {
  console.error('用法：node scripts/derive-kin.mjs data/xx.json [--write]  |  --all [--write]');
  process.exit(1);
}

/** 这一对该不该补？—— 就是上面那张表的代码化。 */
function shouldDerive(k) {
  if (k.kind === 'unrelated' || k.kind === 'self') return false;
  if (k.kind === 'direct') return true;                 // 直系：任意代差
  if (k.kind === 'sibling' || k.kind === 'cousin') return true;
  if (k.kind === 'collateral') return k.gap === 1;      // 旁系只补 1 代
  return false;
}

/** 从 younger 一路往上到 elder 的亲子边序列，用来写推导链。 */
function chainUp(tree, from, to, edgeLabel) {
  const out = [];
  let cur = from;
  for (let step = 0; step < 12; step++) {
    if (cur === to) return out.reverse();
    const ps = (tree.parents.get(cur) ?? []).filter((p) => p !== cur);
    const next = ps.find((p) => !out.some(([a]) => a === p) || true);
    if (!next) break;
    out.push([next, cur]);
    cur = next;
  }
  return out.reverse();
}

/** 这条亲子边的 type 原文（写进推导链，让读者能看到是从哪条边推的） */
function edgeLabel(book, parent, child) {
  for (const r of book.relations || []) {
    if (r.from === parent && r.to === child && isParentChild(r)) {
      return r.type.replace(/[（(].*$/, '');
    }
  }
  return '亲子';
}

let grandTotal = 0;
let reallyChangedTotal = 0;
for (const rel of files) {
  const file = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (!fs.existsSync(file)) { console.log(`  (跳过) 找不到 ${rel}`); continue; }
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bookId = path.basename(file, '.json');
  const name = (id) => book.characters.find((c) => c.id === id)?.name ?? id;

  /* 族谱只从**亲子边**建 —— 推导边本身不能当族谱输入，否则会自我放大 */
  const tree = buildTree(book.relations || [], book.characters || []);
  if (!tree.parents.size) { console.log(`  · ${bookId}：没有亲子边，跳过`); continue; }

  /* 已有关系（不分方向）：手打的都算，已有的推导边会在下面被重建 */
  const has = new Set();
  for (const r of book.relations || []) {
    if (r.derived) continue;                          // 旧的推导边：删掉重建
    has.add(r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`);
  }

  const ids = (book.characters || []).map((c) => c.id);
  const fresh = [];
  const skippedFar = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      if (has.has(`${a}|${b}`)) continue;
      const k = computeKin(tree, a, b);
      if (k.kind === 'unrelated' || k.kind === 'self') continue;
      if (!shouldDerive(k)) { skippedFar.push({ a, b, k }); continue; }

      /* 方向统一为「长辈 → 晚辈」 */
      const elder = k.elder ?? a, younger = k.younger ?? b;
      const chain = chainUp(tree, younger, elder);
      const chainText = chain.length
        ? `由 ${chain.map(([p, c]) => `「${name(p)} —${edgeLabel(book, p, c)}→ ${name(c)}」`).join('、')} 推导`
        : `由族谱（${name(k.lca)} 一线）推导`;
      fresh.push({
        from: elder, to: younger,
        type: `${k.term}（推导）`,
        style: 'dotted', derived: true,
        /* v0.111：路径上含养亲边 ⇒ kin 标 'adoptive'（称谓已带「养」字）。
         * 否则和血亲边混在一起，读者分不出「养祖父」和真「祖父」。 */
        kin: k.adoptive ? 'adoptive' : 'blood',
        events: [{ chapter: '', text: `${chainText}（原文没有直接互动）` }],
      });
      fresh[fresh.length - 1].events[0].evidence = 'derived';
    }
  }

  const before = (book.relations || []).length;
  const oldDerived = (book.relations || []).filter((r) => r.derived).length;

  /* ⚠ 必须在**替换 `book.relations` 之前**抓现存的推导边 type。
   *   下面这行 `book.relations = [...非推导, ...fresh]` 会把旧推导边全滤掉，
   *   而 `derive-kin` 是不动点 ⇒ 那之后再去比永远是「全部相同 / 变化 0」。 */
  const prevByKey = new Map((book.relations || [])
    .filter((r) => r.derived)
    .map((r) => [`${r.from}|${r.to}`, r.type]));

  book.relations = [...(book.relations || []).filter((r) => !r.derived), ...fresh];

  /* ⚠ 分开记两个数（v0.194）。
   *   原来只有一个 `grandTotal += fresh.length`，然后打印成「合计**新生成**推导边 N 条」——
   *   但 `fresh` 是**这次算出来的全部推导边**，不是「相比上次新增的」。
   *   实测三本书 146 + 79 + 0 = **225**，而 `derive-kin` 是不动点
   *   （跑第二遍 fresh 完全一样、落盘零字节变化）⇒ 「新生成 225 条」是**假的**，
   *   真实的新增量是 **0**。
   *   这就是本项目反复抓的那族病：**报的数不是它算的数**。 */
  let reallyChanged = 0;
  for (const f of fresh) {
    if (prevByKey.get(`${f.from}|${f.to}`) !== f.type) reallyChanged++;
  }
  reallyChangedTotal += reallyChanged;
  grandTotal += fresh.length;

  console.log(`  ${bookId}：推导边 ${oldDerived} → ${fresh.length} 条`
    + `　关系总数 ${before} → ${book.relations.length}`
    + `　（有意不补的旁系远亲 ${skippedFar.length} 对）`);
  for (const s of fresh.slice(0, 4)) console.log(`     ＋ ${name(s.from)} —${s.type}— ${name(s.to)}`);
  if (fresh.length > 4) console.log(`     …另 ${fresh.length - 4} 条`);
  for (const s of skippedFar.slice(0, 3)) console.log(`     － ${name(s.a)} —${s.k.term}— ${name(s.b)}（旁系差 ${s.k.gap} 代，按规则不补）`);
  console.log(`     ⇒ 相对磁盘上现有的推导边，**真正变化的 ${reallyChanged} 条**`
    + `（其余 ${fresh.length - reallyChanged} 条逐字相同，属不动点）`);

  if (WRITE) fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
}

/* 两个数分别说清楚，不再混成一个「合计」：
 *   · 推导边总数  —— 脚本算出来的推导边条数（不是新增量）
 *   · 真正变化     —— 与磁盘上现有的推导边逐条比 type，不一样的条数（这才是「改动量」） */
console.log(`\n推导边合计 ${grandTotal} 条（这是**推导边总数**，不是新增量）`);
console.log(`真正变化 ${reallyChangedTotal} 条（与磁盘现状逐条比对 type 的结果）`);
if (!WRITE) console.log('（预览模式：以上数字均为「将会写入什么」，加 --write 才落盘）');
else if (reallyChangedTotal === 0) console.log('（已写入，但内容与写入前完全相同 —— 属不动点，符合预期）');
