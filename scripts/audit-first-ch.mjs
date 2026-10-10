#!/usr/bin/env node
/**
 * firstCh 审计：把 `characters[].firstCh`（首次出场章）与**原著首现章**对拍。
 *
 * ## 为什么需要它
 * `firstCh` 决定两件事：① 剧透保护什么时候解锁这个人；② 章节面板「本章谁初次登场」。
 * 填晚了 ⇒ 人物在该出场的时候被锁住、章节面板漏报。
 *
 * v0.144 手工核出 4 个（王朗 56→15、马良 63→52、李恢 91→60、邓芝 91→85），
 * 但那是**一次性探针**。这个脚本把它固化成可复现的清单。
 *
 * ## 判据（重要：这输出的是「待核清单」，不是「错误清单」）
 * `firstCh` 的口径 = **首次实打实出场**（名单/被提及不算）。
 * 但"名字在原文里首次出现"会被五类东西污染，所以必须**人工核 referent**：
 *
 * | 假阳性 | 例 | 形态 | 本脚本怎么处理 |
 * |---|---|---|---|
 * | **子串碰撞** | 「留平」被匹配到「陈**留平**丘人」 | 名字夹在更长的人名/地名里 | **v0.178 起自动跳过**（见下） |
 * | **评点/注释** | 「黄皓」被匹配到毛宗岗评点「刘禅不用黄皓」 | 出现在 `〚NNN〛` 注释段或回前总评 | 单列「注释」桶 |
 * | **同名不同人** | 「张虎」匹配到第 7 回的江夏张虎，数据里那条是张辽之子 | 去括号后重名 | 自动排除「去括号后同名」的人；**只有一个人**时只能靠台账 |
 * | **名单/被提及** | 邓芝在第 65 回投降名单里，实际出场在第 85 回 | 名单枚举、后人诗、典故引用 | 单列「名单」桶（顿号≥3）／台账 |
 * | **回标题** | 「吕布」在第 3 回**回目**里 | 标题预告本章人物 | ⚠ **未处理**，见文末「已知限制」 |
 *
 * ⇒ 脚本**自动排掉"去括号后同名"**的人物（那类必然假阳性），其余逐条打印
 *   首现处的**上下文片段**，供人工判读。**它不改任何数据。**
 *
 * ## v0.178：补上「子串碰撞」检测 —— 这条判据文档里列了很久，代码里一直没有
 *
 * 判据：`名字` 的首字符之前 1–3 字起、长度 ≥ 名字长度、且**跨越**名字首字符的
 * **已知实体**（`places[]` 的 name/aliases ＋ `characters[]` 的 name/aliases/altNames），
 * 就是"名字被更长的实体吞掉了"。实测命中 3 条（留平 ⊂「陈留」、孙恭 ⊂「公孙恭」、
 * 孙登 ⊂「太子孙」——数据里真有一位只有姓的「吴太子孙」），**三条的 firstCh 本来就是对的**。
 * ⇒ 首现改为「**首个非碰撞的出现**」，这三条直接不再进清单。
 *
 * ⚠ 被跳过的碰撞**必须打印出来**（v0.173 的教训：门禁不打印"跳过了多少条"，
 *   报告就等于装饰品）。
 *
 * ## v0.178：台账 `data/first-ch-ok.json`
 *
 * 剩下的「其余」桶里，有的是**人读过原文、确认 firstCh 本来就对**的
 * （被提及 / 后人诗 / 同名不同人）。这类记进台账 ⇒ 降为计数，
 * 「★其余」桶只留**新冒出来的、还没核的**。台账的门禁是
 * `scripts/check-first-ch-ledger.mjs`。
 *
 * ## 用法
 * ```bash
 * node scripts/audit-first-ch.mjs                    # 三国，阈值 5
 * node scripts/audit-first-ch.mjs --threshold 10     # 只看差 10 回以上的
 * node scripts/audit-first-ch.mjs --top 20           # 只打印前 20 条
 * ```
 * ⚠ **目前只支持三国**（另两本的原著正文没有可用分章标记，见 `BOOKS` 里的说明）。
 * 原著 txt 不在版本库里（CI 跑不了），需本机 `%TEMP%\opencode\ba-books\` 下有一份。
 *
 * ## 已知限制（实测过，别当成"没问题"）
 *
 * 阈值 5 之下还压着 **64 条「其余」**（差 1–5 章）。实测抽样：里面**既有真错**
 * （袁绍 fc3 首现 2、吕布 fc4 首现 3、甘宁 fc39 首现 38、姜维 fc93 首现 92），
 * **也混着**回目标题（吕布/贾诩/严颜/管辂/孙礼/文鸯）、名单枚举（十八路诸侯的
 * 刘岱/乔瑁，用「第N镇，…。」分隔 ⇒ 顿号不足 3 个、骗过「名单」判据）、
 * 被提及。⇒ **把阈值降到 1 会把 64 条噪声一起倒出来**，需要先做一个
 * 「回目标题 / 枚举名单」的识别器。本轮没做，如实记在这里。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_TXT = path.join(os.tmpdir(), 'opencode', 'ba-books', '三国演义.txt');
export const DEFAULT_THRESHOLD = 5;
export const LEDGER_REL = 'data/first-ch-ok.json';
/** 台账 `kind` 的闭集 —— 门禁与审计**共用这一份**（不抄第二遍）。 */
export const KINDS = ['同名不同人', '被提及', '后人诗', '名单枚举', '子串碰撞', '其他'];

/* 各书的分章方式。
 * ⚠ 只有三国的原著正文带分章标记（「第N回」）；另两本的 txt 分了章但正文没有标记：
 *   百年孤独 —— 「第N章」只出现在目录里，正文段落之间无标记；
 *   罪与罚   —— 按「部」重编号（第一部第一~七章、第二部第一~七章…），与数据的顺序章号 1..41 不对应。
 *   两本都只有 60/38 人，手工核更快。 */
const BOOKS = {
  'three-kingdoms': { txt: '三国演义.txt', split: /^第([一二三四五六七八九十百零]+)回/gm, cn: true },
  'one-hundred-years-of-solitude': { txt: '百年孤独.txt', unsupported: '原著正文里没有章节标记（「第N章」只出现在目录），无法机械分章' },
  'crime-and-punishment': { txt: '罪与罚.txt', unsupported: '原著按「部」重编号（每部都从第一章起），与数据的顺序章号 1..41 不对应' },
};

const CN = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cn2n(s) {
  if (s === '零') return 0;
  let t = 0, tmp = 0;
  for (const ch of s) {
    if (ch === '百') { tmp = (tmp || 1) * 100; t += tmp; tmp = 0; }
    else if (ch === '十') { tmp = (tmp || 1) * 10; t += tmp; tmp = 0; }
    else tmp = CN[ch] || 0;
  }
  return t + tmp;
}

const base = (n) => String(n || '').replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
const flat = (x) => String(x || '').replace(/[ \t　]/g, '');

/** 切章。⚠ 索引必须与匹配用的文本同源（v0.144 踩过：在原文上算分章、拿去切去空格文本 ⇒ 第93回报成第6回）。 */
function splitChapters(flatText, cfg, totalCh) {
  const heads = [];
  { const re = cfg.split; let m; while ((m = re.exec(flatText))) heads.push({ idx: m.index, n: cfg.cn ? cn2n(m[1]) : Number(m[1]) }); }
  if (heads.length < 2) return null;
  /** 目录 + 正文各一份时取后一半；编号连续 1..N 的那段才是正文 */
  const pick = (list) => {
    if (list.length === totalCh && list.every((x, i) => x.n === i + 1)) return list;
    const tail = list.slice(list.length - totalCh);
    if (tail.every((x, i) => x.n === i + 1)) return tail;
    return list.slice(Math.floor(list.length / 2));
  };
  const body = pick(heads);
  return body.map((h, i) => ({ ch: i + 1, start: h.idx, end: i + 1 < body.length ? body[i + 1].idx : flatText.length }));
}

/** 书里的「已知实体」——用来判子串碰撞（人名的 name/aliases/altNames ＋ 地名）。 */
function entityIndex(book) {
  const set = new Set();
  for (const p of book.places || []) { if (p.name) set.add(p.name); for (const a of p.aliases || []) set.add(a); }
  for (const c of book.characters) {
    if (c.name) set.add(base(c.name));
    for (const a of c.aliases || []) set.add(a);
    for (const a of c.altNames || []) set.add(a);
  }
  const byFirst = new Map();
  for (const e of set) {
    if (!e || e.length < 2) continue;
    if (!byFirst.has(e[0])) byFirst.set(e[0], []);
    byFirst.get(e[0]).push(e);
  }
  return byFirst;
}

/** `text` 里 `pos` 处的 `name` 是不是被更长的实体吞掉了（子串碰撞）？返回那个实体或 null。
 *
 * ⚠ `self` = **这个人自己的**名字/别名集合，必须排除掉。否则数据里那些
 *   「官职/地名 + 人名」形式的**合法别名**会把本人误判成碰撞 ——
 *   实测三国里有 8 个（「左将军张布」「襄阳党均」「天水太守王颀」「中常侍黄皓」…），
 *   它们是有意为之（原著常只写「左将军曰」），不是坏数据。
 *   ⇒ 判据是"被**别人**（或地名）吞掉"，不是"被自己的别名吞掉"。 */
export function collisionAt(text, pos, name, byFirst, self) {
  for (let back = 1; back <= 3; back++) {
    const s = pos - back;
    if (s < 0) continue;
    for (const e of byFirst.get(text[s]) || []) {
      if (e === name || e.length < name.length) continue;
      if (self && self.has(e)) continue;
      if (text.startsWith(e, s) && s + e.length > pos) return e;
    }
  }
  return null;
}

/**
 * 名字在原文里的**首个非碰撞出现**。
 * @returns {{ch:number, at:number, skipped:Array<{ch:number, at:number, ent:string}>}|null}
 */
export function firstCleanOccur(segText, name, byFirst, self) {
  const skipped = [];
  for (let i = 0; i < segText.length; i++) {
    const t = segText[i];
    let p = 0;
    while ((p = t.indexOf(name, p)) >= 0) {
      const ent = collisionAt(t, p, name, byFirst, self);
      if (!ent) return { ch: i + 1, at: p, skipped };
      skipped.push({ ch: i + 1, at: p, ent });
      p += 1;
    }
  }
  return null;
}

/**
 * 跑一次审计。**不在模块加载时执行任何 IO**（门禁脚本要 import 它，CI 上没原著）。
 */
export function auditFirstCh(opts = {}) {
  const slug = opts.slug || 'three-kingdoms';
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const cfg = BOOKS[slug];
  if (!cfg) return { error: `未知书目：${slug}（可选：${Object.keys(BOOKS).join(' / ')}）` };
  if (cfg.unsupported) return { error: `${slug} 暂不支持：${cfg.unsupported}`, unsupported: true };

  const txtPath = opts.txtPath || path.join(os.tmpdir(), 'opencode', 'ba-books', cfg.txt);
  const bookPath = opts.bookPath || path.join(opts.root || ROOT, 'data', `${slug}.json`);
  const ledgerPath = opts.ledgerPath || path.join(opts.root || ROOT, LEDGER_REL);
  if (!fs.existsSync(txtPath)) return { error: `找不到原著：${txtPath}`, missingTxt: true };

  const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
  const totalCh = book.meta?.chapters || 0;
  /* ⚠ 只 `flat()` 一次，分章与切片都用同一个串 —— 两次 flat 虽然结果相同，
   *   但那是"碰巧"，索引同源这条要写死在代码里（v0.144 踩过索引错位的坑）。 */
  const flatText = flat(fs.readFileSync(txtPath, 'utf8'));
  const segs = splitChapters(flatText, cfg, totalCh);
  if (!segs) return { error: '分章正则没匹配到内容 —— 原著格式可能变了' };
  const segText = segs.map((s) => flatText.slice(s.start, s.end));
  const byFirst = entityIndex(book);

  /* ── 排掉「去括号后同名」（必然假阳性） ── */
  const nameCount = new Map();
  for (const c of book.characters) nameCount.set(base(c.name), (nameCount.get(base(c.name)) || 0) + 1);

  /* ── 台账：本 book 已核过的名字 ── */
  const reviewed = new Map();
  let ledgerBroken = null;
  if (fs.existsSync(ledgerPath)) {
    try {
      for (const e of JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))) {
        if (e && e.book === slug) reviewed.set(e.name, e);
      }
    } catch (err) { ledgerBroken = err.message; }
  }

  const cand = [];
  const noFc = [];
  const collisions = [];
  let skippedDup = 0, skippedShort = 0, notFound = 0, dupNoFc = 0;

  for (const c of book.characters) {
    const b = base(c.name);
    const fc = Number(c.firstCh);
    if (b.length < 2) { skippedShort++; continue; }
    if ((nameCount.get(b) || 0) > 1) {
      skippedDup++;
      /* ⚠ 去括号后同名 ⇒「名字首现」指向谁不确定，对拍必须排除。
       *   但**缺 firstCh** 的人不能因此被静默丢掉——否则报告会少报（v0.158 修：
       *   三国里 `雷同（雒城）`/`雷同（巴西）` 就是这情形，后者曾被整个跳过）。 */
      if (!Number.isFinite(fc)) { dupNoFc++; noFc.push({ name: c.name, id: c.id, first: null, ctx: '', dup: true }); }
      continue;
    }
    const occ = firstCleanOccur(segText, b, byFirst, new Set([b, c.name, ...(c.aliases || []), ...(c.altNames || [])]));
    if (occ) for (const s of occ.skipped) collisions.push({ name: c.name, ...s });
    if (!Number.isFinite(fc)) {
      if (occ) {
        const seg = segText[occ.ch - 1];
        noFc.push({ name: c.name, id: c.id, first: occ.ch, ctx: seg.slice(Math.max(0, occ.at - 40), occ.at + b.length + 40) });
      } else noFc.push({ name: c.name, id: c.id, first: null, ctx: '' });
      continue;
    }
    if (occ === null) { notFound++; continue; }
    const d = fc - occ.ch;
    if (d > threshold) {
      const seg = segText[occ.ch - 1];
      const ctx = seg.slice(Math.max(0, occ.at - 45), occ.at + b.length + 45);
      const around = seg.slice(Math.max(0, occ.at - 40), occ.at + b.length + 40);
      const dun = (around.match(/、/g) || []).length;                 // 顿号密集 ⇒ 名单枚举
      const annot = around.includes('〚') || seg.slice(Math.max(0, occ.at - 30), occ.at).includes('〚');
      const kind = annot ? '注释' : (dun >= 3 ? '名单' : '其余');
      const led = reviewed.get(c.name);
      cand.push({ name: c.name, id: c.id, fc, first: occ.ch, d, ctx, kind, reviewed: !!led, why: led?.why || '' });
    }
  }
  cand.sort((a, b) => b.d - a.d);
  noFc.sort((a, b) => (a.first ?? 1e9) - (b.first ?? 1e9));
  collisions.sort((a, b) => a.ch - b.ch);

  /* 台账里对本 book 记了、但**数据里对不上**的条目（本机提示；硬判据在门禁里） */
  const ledgerUnmatched = [];
  const byName = new Map(book.characters.map((c) => [c.name, c]));
  for (const [name, e] of reviewed) {
    const c = byName.get(name);
    if (!c) ledgerUnmatched.push(`${name}：数据里没有这个人`);
    else if (Number(c.firstCh) !== Number(e.firstCh)) ledgerUnmatched.push(`${name}：台账 firstCh=${e.firstCh}，数据 firstCh=${c.firstCh}`);
  }

  const rest = cand.filter((x) => x.kind === '其余');
  return {
    slug, threshold, people: book.characters.length, totalCh,
    skippedDup, skippedShort, notFound, dupNoFc,
    cand, noFc, collisions, ledgerUnmatched, ledgerBroken,
    reviewedCount: rest.filter((x) => x.reviewed).length,
    unReviewed: rest.filter((x) => !x.reviewed),
  };
}

/** 把审计结果渲染成报告文本（与 CLI 输出完全一致 ⇒ 守卫能直接断言它）。 */
export function renderReport(r, top = Infinity) {
  const L = [];
  if (r.error) { L.push(`✗ ${r.error}`); return L.join('\n'); }
  const by = (k) => r.cand.filter((x) => x.kind === k);
  L.push(`\n▶ ${r.slug}（${r.people} 人 / ${r.totalCh} 章）`);
  L.push(`  阈值：firstCh 比原文首现晚 > ${r.threshold} 章`);
  L.push(`  已排除：去括号后同名 ${r.skippedDup} 人（必然假阳性）· 名字<2字 ${r.skippedShort} 人`);
  L.push(`  原文里找不到名字：${r.notFound} 人（多为字号/别称，或数据里的写法与原著不同）`);
  L.push(`  缺 firstCh：${r.noFc.length} 人${r.dupNoFc ? `（其中 ${r.dupNoFc} 人同名，无法给建议值）` : ''} —— 单列在下（给「名字首现」作建议值，仍需人工核出场口径）`);
  L.push(`  ⚠ 已跳过**子串碰撞** ${r.collisions.length} 处（名字被更长的人名/地名吞掉）—— 见文末`);
  if (r.ledgerBroken) L.push(`  ⚠ 台账解析失败（${r.ledgerBroken}）—— 当作"一条都没核过"处理（宁可多报）`);
  for (const u of r.ledgerUnmatched) L.push(`  ⚠ 台账与数据对不上：${u}`);
  L.push(`\n  ⚠ 以下 ${r.cand.length} 条是**待核清单**，不是错误清单 —— 必须看上下文核 referent。`);
  L.push('    已按首现形态分三组，「其余」才是真正值得核的。');

  const GROUPS = [
    ['其余', '★ 最值得核：既不在名单里、也不在注释里'],
    ['名单', '顿号密集 ⇒ 多半是「投降/封赏名单」枚举；firstCh 口径**不含名单** ⇒ 多为假阳性'],
    ['注释', '出现在毛宗岗评点/校记（`〚NNN〛`）里 ⇒ 假阳性'],
  ];
  for (const [label, note] of GROUPS) {
    const arr = by(label);
    if (!arr.length) continue;
    const shown = label === '其余' ? arr.filter((x) => !x.reviewed) : arr;
    const hidden = arr.length - shown.length;
    L.push(`\n### ${label}（${arr.length} 条）—— ${note}`);
    if (label === '其余' && hidden) L.push(`  其中 ${hidden} 条**已回原著核过**（见 ${LEDGER_REL} 的 why 栏）⇒ 不再列出；下面只列**未核**的。`);
    if (!shown.length) { L.push('  （没有未核的 ⇒ 本桶已清零）'); continue; }
    L.push('');
    L.push('  | 人物 | firstCh | 原文首现 | 差 | 首现处上下文 |');
    L.push('  |---|---|---|---|---|');
    const show = label === '其余' ? shown.slice(0, top) : shown.slice(0, Math.min(top, 6));
    for (const x of show) L.push(`  | ${x.name} | ${x.fc} | ${x.first} | ${x.d} | …${x.ctx.replace(/\|/g, '\\|')}… |`);
    if (shown.length > show.length) L.push(`  | … | | | | 还有 ${shown.length - show.length} 条（用 --top 调整） |`);
  }
  if (r.noFc.length) {
    L.push(`\n### 缺 firstCh（${r.noFc.length} 人）—— 建议值，⚠ 必须人工核\n`);
    L.push('  名字首现 ≠ 首次出场（名单/被提及不算）。下表给的是**名字首现章**，只能当建议值；');
    L.push('  要定 firstCh，得看该处上下文是不是"实打实出场"。');
    L.push(r.dupNoFc ? `  ⚠ 其中 ${r.dupNoFc} 人「去括号后与另一人同名」⇒ 名字首现指向谁不确定，给不了建议值，须人工判。\n` : '');
    L.push('  | 人物 | id | 名字首现 | 首现处上下文 |');
    L.push('  |---|---|---|---|');
    for (const x of r.noFc.slice(0, top)) {
      const firstCell = x.dup ? '**同名，不可判**' : (x.first ?? '—');
      const ctxCell = x.dup ? '（去括号后与另一人同名，名字首现指向谁不确定）' : `…${x.ctx.replace(/\|/g, '\\|')}…`;
      L.push(`  | ${x.name} | \`${x.id}\` | ${firstCell} | ${ctxCell} |`);
    }
    if (r.noFc.length > top) L.push(`  | … | | | 还有 ${r.noFc.length - top} 人（用 --top 调整） |`);
  }
  if (r.collisions.length) {
    L.push(`\n### 已跳过的子串碰撞（${r.collisions.length} 处）—— 首现已顺延到下一个干净的出现\n`);
    for (const s of r.collisions.slice(0, top)) L.push(`  · ${s.name}（回${s.ch}）⊂「${s.ent}」`);
    if (r.collisions.length > top) L.push(`  · …另 ${r.collisions.length - top} 处`);
  }
  L.push('');
  L.push(`  ⇒ 确认是错的，用 \`scripts/fix-*.mjs\` 那套（带原著 locate 短语）去改；`);
  L.push(`    核过确认 firstCh 本来就对的，记进 \`${LEDGER_REL}\`（门禁 \`scripts/check-first-ch-ledger.mjs\`）。`);
  L.push('    本脚本**不改任何数据**。\n');
  return L.join('\n');
}

/* ── CLI ── */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const r = auditFirstCh({
    slug: arg('--book', 'three-kingdoms'),
    threshold: Number(arg('--threshold', DEFAULT_THRESHOLD)),
    txtPath: arg('--txt', undefined),
    bookPath: arg('--data', undefined),
  });
  if (r.error) { console.error(`✗ ${r.error}`); process.exit(1); }
  console.log(renderReport(r, Number(arg('--top', 0)) || Infinity));
  console.log(`  （供人工核的量：${r.unReviewed.length} 条未核；已核 ${r.reviewedCount} 条；判据见文件头 v0.144 / v0.158 / v0.178）`);
  /* ⚠ 不给非零退出码：这是**报告**，不是门禁（与 v0.144 的定位一致）。
   *   要"卡住"，用 `--strict`（本机手工步骤）。 */
  if (argv.includes('--strict') && r.unReviewed.length) process.exit(1);
}
