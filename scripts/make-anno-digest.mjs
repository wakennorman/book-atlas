/* 生成「拆书素材」文档：把库里已核对的数据重排成写拆解时能直接引用的形式。
 *
 * ⚠ 这份文档是**素材**，不是拆解。
 *   素材 = 从 data/<slug>.json 机械重排出来的既有数据（可逐条核对）；
 *   拆解 = 我/作者的判断（推断）。两者必须分开，界面上也要分开标注
 *   （见 renderAnnotations 的 annoBasis）。
 *
 * 为什么要写成脚本而不是手抄：
 *   手抄 700 条事件必然出错，而且**抄错了看不出来** —— 那正是这个项目反复踩的
 *   「改了等于没改 / 编造混进真数据」那一族。脚本生成可复现、可 diff、可 --check。
 *
 * 用法：
 *   node scripts/make-anno-digest.mjs            # 生成
 *   node scripts/make-anno-digest.mjs --check     # 只校验是否与数据同步（进 CI）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'docs');
const check = process.argv.includes('--check');

/** 章号解析：与 js/app.js 的 chOf 同一口径（「第21章」这种字符串要抽数字） */
const chOf = (s) => { const m = String(s === undefined || s === null ? '' : s).match(/(\d+)/); return m ? Number(m[1]) : null; };

/** 死亡类关系类型：用来在素材里标出"哪一章决定了谁的结局"，是拆解的天然锚点 */
const DEATH_TYPES = ['弑杀', '部将弑主', '君主与后妃（弑杀）', '诛杀', '弑主', '背叛诛杀'];

const FROM = 15, TO = 120;          // 本次整理的范围（第 1–14 回已写过，附在末尾对照）

function slugOf() { return process.argv.find((a) => a.startsWith('--slug='))?.slice(7) || 'three-kingdoms'; }
const slug = slugOf();
const src = JSON.parse(fs.readFileSync(path.join(DATA, `${slug}.json`), 'utf8'));
const nameOf = new Map(src.characters.map((c) => [c.id, c.name]));
const phaseOf = new Map((src.phases || []).map((p) => [p.id, p.name]));

/* ---------- 素材统计（先算，后面每条结论都从这里来，不手填） ---------- */
const evAll = src.events || [];
const inRange = (ch) => ch >= FROM && ch <= TO;
const evInRange = evAll.filter((e) => inRange(Number(e.ch)));
const chWithEvents = new Set(evAll.map((e) => Number(e.ch)));
const missingCh = [];
for (let c = FROM; c <= TO; c++) if (!chWithEvents.has(c)) missingCh.push(c);

/* 关系事件：章号可解析的那些 */
let relEvTotal = 0, relEvParsed = 0, relEvBadCh = 0;
const relEvByCh = new Map();
const deathMarks = [];
for (const r of src.relations || []) {
  for (const e of r.events || []) {
    relEvTotal++;
    const c = chOf(e.chapter);
    if (c == null) { relEvBadCh++; continue; }
    relEvParsed++;
    if (!inRange(c)) continue;
    relEvByCh.set(c, (relEvByCh.get(c) || 0) + 1);
    if (DEATH_TYPES.includes(r.type)) {
      deathMarks.push({ ch: c, type: r.type, to: nameOf.get(r.to) || r.to, from: nameOf.get(r.from) || r.from });
    }
  }
}
deathMarks.sort((a, b) => a.ch - b.ch);

/* 人物线索引：谁在这一段的事件里出现得最多（谁的戏最多） */
const charFreq = new Map();
for (const e of evInRange) for (const id of e.chars || []) charFreq.set(id, (charFreq.get(id) || 0) + 1);

/* 首次登场：人物所属章 = firstCh，落在范围内的 */
const debutInRange = [];
for (const c of src.characters) {
  const fc = chOf(c.firstCh);
  if (fc != null && inRange(fc)) debutInRange.push({ ch: fc, name: c.name, faction: c.faction });
}
debutInRange.sort((a, b) => a.ch - b.ch);

/* 素材口径：evidence 字段的分布 + 有多少条带原文引文 */
const evKind = {};
for (const e of evInRange) evKind[e.evidence || '(空)'] = (evKind[e.evidence || '(空)'] || 0) + 1;
const withQuote = evInRange.filter((e) => e.quote).length;

/* ---------- 逐章正文：按阶段分文件 ----------
 *
 * 为什么分文件而不是塞进一个大文档：
 *   ① 一次性把 620 条事件全导出是 197KB，其中「首次登场」那段塞了大量一次性配角，
 *      压过了真正有用的主体。分文件后导航页只留索引，主体按阶段读。
 *   ② 写拆解时是**按阶段推进**的（官渡 → 赤壁 → 鼎立 → 衰亡 → 归晋），
 *      一个阶段一个文件正好对应一次工作单元。
 * ⚠ 分文件后 --check 必须逐个比对，否则旧文件会静默留在 docs/ 里变成过期内容
 *   —— 这正是 memory/book-atlas-slim-packs-are-what-web-actually-loads 那个坑。 */
function chapterSection(c) {
  const evs = evAll.filter((e) => Number(e.ch) === c).sort((a, b) => (a.order || 0) - (b.order || 0));
  const relN = relEvByCh.get(c) || 0;
  const deaths = deathMarks.filter((d) => d.ch === c);
  const debuts = debutInRange.filter((d) => d.ch === c);
  const ph = evs.length ? phaseOf.get(evs[0].phase) : '';
  const out = [];
  out.push(`### 第 ${c} 回${ph ? ` · ${ph}` : ''}`);
  out.push('');
  const meta = [];
  meta.push(`事件 ${evs.length} 条`);
  meta.push(`关系事件 ${relN} 条`);
  if (deaths.length) meta.push(`**死亡节点 ${deaths.length} 个：${deaths.map((d) => `${d.from}→${d.to}`).join('、')}**`);
  if (debuts.length) meta.push(`首次登场 ${debuts.length} 人：${debuts.map((d) => d.name).join('、')}`);
  out.push(meta.join(' · '));
  out.push('');
  if (!evs.length) {
    out.push(relN
      ? `⚠ **本章没有独立事件**（\`events[]\` 为空）。可引用的只有关系事件 ${relN} 条。`
      : '⚠ **本章既无独立事件、也无关系事件** —— 素材不足，建议留空不写。');
    out.push('');
    return out.join('\n');
  }
  for (const e of evs) {
    out.push(`- **\`${e.id}\` ${e.name}** — ${e.summary || ''}`);
    if (e.impact) out.push(`  ↳ 影：${e.impact}`);
    if (e.quote) out.push(`  ↳ 原文引文：「${e.quote}」`);
    if (e.place) out.push(`  ↳ 地点：${e.place}`);
    out.push(`  ↳ 可引用 id：\`${e.id}\`${(e.chars || []).length ? ` · 人物 ${e.chars.map((x) => nameOf.get(x) || x).join('、')}` : ''}`);
  }
  out.push('');
  return out.join('\n');
}

/* 按阶段切分（阶段名里带「15–33 回」这样的回次范围） */
const phasesInRange = (src.phases || []).map((p) => {
  const m = String(p.name).match(/(\d+)[–\-~](\d+)/);
  return m ? { p, a: Number(m[1]), z: Number(m[2]) } : null;
}).filter(Boolean).filter((x) => x.z >= FROM);

/* ---------- 导览页正文 ---------- */
const L = [];
L.push(`# 拆书素材 ·《三国演义》第 ${FROM}–${TO} 回（导览）`);
L.push('');
L.push('> **这份文档是「素材」，不是「拆解」。**');
L.push('>');
L.push('> - **素材** = 从 `data/three-kingdoms.json` 机械重排出来的既有数据（事件、关系事件、登场表）。每条都能点回原始 id 核对。');
L.push('> - **拆解** = 作者对「这一章在全书里起什么作用」的判断，**那是推断，不是原文**。');
L.push('>');
L.push('> 界面上两者必须分开标注（见 `js/app.js` 的 `annoBasis`：依据标签会显式写「整理者推断」）。');
L.push('');
L.push(`由 \`node scripts/make-anno-digest.mjs\` 生成，请勿手改；改动请改脚本或数据后重跑（\`--check\` 会校验是否同步）。`);
L.push('');
L.push('**这一页只有口径、索引和导航。逐章素材按阶段拆在同目录的 `拆书素材-<slug>-*.md` 里** ——');
L.push('写拆解时是按阶段推进的（官渡 → 赤壁 → 鼎立 → 衰亡 → 归晋），一个阶段一个文件正好对应一次工作单元。');
L.push('');

L.push('## 一、素材口径与已知缺口');
L.push('');
L.push('写拆解之前必须先知道素材能支撑到什么程度。以下都是**实测数字**，不是估计：');
L.push('');
L.push('| 项 | 数值 | 说明 |');
L.push('|---|---|---|');
L.push(`| 事件总数（${FROM}–${TO} 回） | **${evInRange.length}** | 独立 \`events[]\`，每条有 name / summary / impact |`);
L.push(`| 带原文引文（\`quote\`）的事件 | **${withQuote}** | 只有这些能标「原文依据」 |`);
L.push(`| \`evidence\` 分布 | ${Object.entries(evKind).map(([k, v]) => `\`${k}\` ${v}`).join('、')} | ⚠ **全部是 paraphrase（转述）**，不是逐字原文 |`);
L.push(`| 关系事件总数 | ${relEvTotal} | \`relations[].events[]\`，是关系线的小事件 |`);
L.push(`| 其中章号可解析 | ${relEvParsed} | 「第21章」这种字符串要用正则抽数字 |`);
L.push(`| 其中章号**不可解析** | **${relEvBadCh}** | ⚠ 这些关系事件没有可用的章号，**按章引用时会漏掉** |`);
L.push(`| ${FROM}–${TO} 回内有关系事件的章 | **${[...relEvByCh.keys()].filter((c) => inRange(c)).length} / ${TO - FROM + 1}** | 剩下几章没有关系事件可引用 |`);
if (missingCh.length) L.push(`| **无任何事件章的事件表** | **第 ${missingCh.join('、')} 回** | ⚠ 这些回在 \`events[]\` 里是空的，拆解只能靠关系事件或留空 |`);
L.push('');
L.push('**由此得出的三条硬约束：**');
L.push('');
L.push('1. `summary` 是**转述**。写拆解时**不能**说「原文写道…」，只能说「本书整理为…」。');
L.push(`2. 只有 ${withQuote} 条事件带 \`quote\`，那是**唯一**能标「原文依据」的地方。其余一律「整理者推断」。`);
L.push(`3. 第 ${missingCh.join('、')} 回没有独立事件，${TO - FROM + 1 - missingCh.length} 章里也有 ${106 - [...relEvByCh.keys()].filter((c) => inRange(c)).length} 章没有关系事件 —— **这些回不写比硬凑好**。`);
L.push('');

L.push('## 二、阶段索引');
L.push('');
L.push('| 阶段 | 回次 | 事件数 | 关系事件数 |');
L.push('|---|---|---|---|');
for (const p of src.phases || []) {
  const m = String(p.name).match(/(\d+)[–\-~](\d+)/);
  if (!m) continue;
  const a = Number(m[1]), z = Number(m[2]);
  if (z < FROM) continue;
  const lo = Math.max(a, FROM), hi = Math.min(z, TO);
  const evs = evAll.filter((e) => Number(e.ch) >= lo && Number(e.ch) <= hi).length;
  let rels = 0;
  for (const c of relEvByCh.keys()) if (c >= lo && c <= hi) rels += relEvByCh.get(c);
  L.push(`| ${p.name} | ${a}–${z}${a < FROM ? `（本轮取 ${FROM}–${z}）` : ''} | ${evs} | ${rels} |`);
}
L.push('');

L.push('## 三、死亡节点（拆解的天然锚点）');
L.push('');
L.push(`${FROM}–${TO} 回内被记录下来的死亡类关系事件只有 **${deathMarks.length}** 条 —— 远少于原著实际死亡人数，**只能当锚点、不能当"这一章死了谁"的完整清单**。`);
L.push('');
if (deathMarks.length) {
  L.push('| 章 | 关系 | 涉及 |');
  L.push('|---|---|---|');
  for (const d of deathMarks) L.push(`| 第 ${d.ch} 回 | ${d.type} | ${d.from} → ${d.to} |`);
} else L.push('（无）');
L.push('');

/* ---------- 五、逐章索引 + 阶段文件导航 ---------- */
L.push(`## 五、逐章索引与阶段文件`);
L.push('');
L.push('格式：`事件 id 名称` — 摘要，↳ 影：影响；引号内是原文引文（仅少数事件有）。');
L.push('');

/* 先把各阶段文件内容备好，导航页只列索引 */
const files = [];
for (const { p, a, z } of phasesInRange) {
  const lo = Math.max(a, FROM), hi = Math.min(z, TO);
  const body = [];
  body.push(`# 拆书素材 ·《三国演义》第 ${lo}–${hi} 回 · ${p.name}`);
  body.push('');
  body.push(`> 由 \`node scripts/make-anno-digest.mjs\` 生成，勿手改。[← 回导览](./拆书素材-${slug}.md)`);
  body.push('');
  body.push(`阶段口径：${p.name}。素材 = 既有数据，拆解 = 作者判断，两者分开标注。`);
  body.push('');
  const idx = [];
  for (let c = lo; c <= hi; c++) {
    const evs = evAll.filter((e) => Number(e.ch) === c).sort((a, b) => (a.order || 0) - (b.order || 0));
    const relN = relEvByCh.get(c) || 0;
    const deaths = deathMarks.filter((d) => d.ch === c);
    const names = evs.map((e) => e.name).join('、') || '（无独立事件）';
    const tail = deaths.length ? `　**☠ ${deaths.map((d) => `${d.from}→${d.to}`).join('、')}**` : '';
    idx.push(`| ${c} | ${evs.length} | ${relN} | ${names} |${tail}`);
  }
  body.push('| 回 | 事件 | 关系事件 | 事件名 | 死亡节点 |');
  body.push('|---|---|---|---|---|');
  body.push(...idx);
  body.push('');
  body.push('---');
  body.push('');
  for (let c = lo; c <= hi; c++) body.push(chapterSection(c));
  const fileName = `拆书素材-${slug}-${lo}-${hi}.md`;
  files.push({ fileName, content: body.join('\n') });
  const evN = evAll.filter((e) => Number(e.ch) >= lo && Number(e.ch) <= hi).length;
  let relN = 0;
  for (const c of relEvByCh.keys()) if (c >= lo && c <= hi) relN += relEvByCh.get(c);
  L.push(`### ${p.name}（第 ${lo}–${hi} 回）— 事件 ${evN} 条 / 关系事件 ${relN} 条`);
  L.push('');
  L.push(`→ **[\`${fileName}\`](./${fileName})**　${(Buffer.byteLength(body.join('\n'), 'utf8') / 1024).toFixed(1)}KB`);
  L.push('');
  /* 导航页只放一行一节的极简索引，主体去阶段文件 */
  for (let c = lo; c <= hi; c++) {
    const evs = evAll.filter((e) => Number(e.ch) === c).sort((a, b) => (a.order || 0) - (b.order || 0));
    const relN = relEvByCh.get(c) || 0;
    const deaths = deathMarks.filter((d) => d.ch === c);
    const names = evs.map((e) => e.name).join('、') || '（无独立事件）';
    const tail = deaths.length ? `　**☠ ${deaths.map((d) => `${d.from}→${d.to}`).join('、')}**` : '';
    L.push(`- **第 ${c} 回** · 事件 ${evs.length} / 关系 ${relN}：${names}${tail}`);
  }
  L.push('');
}

L.push(`## 附：第 1–${FROM - 1} 回（已写过拆解，仅供对照）`);
L.push('');
for (let c = 1; c < FROM; c++) {
  const evs = evAll.filter((e) => Number(e.ch) === c).sort((a, b) => (a.order || 0) - (b.order || 0));
  const relN = relEvByCh.get(c) || 0;
  L.push(`- **第 ${c} 回**：事件 ${evs.length} 条（${evs.map((e) => e.name).join('、')}）· 关系事件 ${relN} 条`);
}
L.push('');

L.push('## 六、人物登场密集度');
L.push('');
L.push('用来定位「这一段是谁的戏」。前 30 名（在范围内出现的事件次数）：');
L.push('');
const top = [...charFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
L.push('| 人物 | 事件次数 | | 人物 | 事件次数 |');
L.push('|---|---|---|---|---|');
for (let i = 0; i < top.length; i += 2) {
  const a = top[i], b = top[i + 1];
  L.push(`| ${a ? nameOf.get(a[0]) || a[0] : ''} | ${a ? a[1] : ''} | | ${b ? nameOf.get(b[0]) || b[0] : ''} | ${b ? b[1] : ''} |`);
}
L.push('');
L.push(`首次登场落在本范围内的人物共 **${debutInRange.length}** 人 —— 绝大多数是一次性配角，`);
L.push('**完整的名单在各阶段文件的每章抬头里**（`首次登场 N 人：…`），这里不重复列，避免压过主体。');
L.push('');

/* ---------- 写盘 ---------- */
fs.mkdirSync(OUT_DIR, { recursive: true });
const navName = `拆书素材-${slug}.md`;
const expected = [navName, ...files.map((f) => f.fileName)];

function writeOrCheck(name, content) {
  const p = path.join(OUT_DIR, name);
  if (check) {
    if (!fs.existsSync(p)) { console.error(`✗ docs/${name} 不存在，跑 node scripts/make-anno-digest.mjs`); return false; }
    if (fs.readFileSync(p, 'utf8') !== content) { console.error(`✗ docs/${name} 与 data/${slug}.json 不同步（跑 node scripts/make-anno-digest.mjs）`); return false; }
    return true;
  }
  fs.writeFileSync(p, content, 'utf8');
  console.log(`  ${(Buffer.byteLength(content, 'utf8') / 1024).toFixed(1).padStart(7)}KB  docs/${name}`);
  return true;
}

let bad = 0;
if (!writeOrCheck(navName, L.join('\n'))) bad++;
for (const f of files) if (!writeOrCheck(f.fileName, f.content)) bad++;

/* ⚠ 过期文件清理：阶段范围一改，旧的 -*.md 会静默留在 docs/ 里变成过期内容。
 *   这正是 memory/book-atlas-slim-packs-are-what-web-actually-loads 那个坑的另一种形态。 */
if (!check) {
  for (const n of fs.readdirSync(OUT_DIR)) {
    if (!n.startsWith(`拆书素材-${slug}-`) || !n.endsWith('.md')) continue;
    if (expected.includes(n)) continue;
    fs.unlinkSync(path.join(OUT_DIR, n));
    console.log(`  已删除过期文件 docs/${n}`);
  }
}

if (check && bad) { console.error('\n拆书素材与数据不同步'); process.exit(1); }
if (check) {
  console.log(`✓ 拆书素材（导览 + ${files.length} 个阶段文件）与 data/${slug}.json 同步`);
} else {
  console.log(`\n✓ 已生成导览 + ${files.length} 个阶段文件`);
  console.log(`  范围 第 ${FROM}–${TO} 回 · 事件 ${evInRange.length} 条 · 关系事件 ${[...relEvByCh.entries()].filter(([c]) => inRange(c)).reduce((a, [, n]) => a + n, 0)} 条`);
  if (missingCh.length) console.log(`  ⚠ 无独立事件的章：第 ${missingCh.join('、')} 回（已在文档里标出）`);
  if (relEvBadCh) console.log(`  ⚠ 章号不可解析的关系事件 ${relEvBadCh} 条（按章引用时会漏）`);
}

/* ---------- 导航页正文（从「五、逐章索引」往后在下方继续追加） ---------- */