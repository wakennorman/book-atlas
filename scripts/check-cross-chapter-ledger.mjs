/* A3 跨章声明台账（`data/cross-chapter-ok.json`）的**一致性**检查 —— v0.177 新增。
 *
 * ## 台账是什么
 *
 * `scripts/audit-annotations.mjs` 的 A3 判据是「条目 `events[]` 里声明了章号 ≠
 * 本条 `ch` 的事件」，原文标注「需人工确认是否有意」。v0.177 把这 11 处
 * **回原著逐条核过**（结论：`ch` 没有一处写错，全部是有意跨章），结论写进这份台账，
 * 消费方（审计脚本）读到就不再报「需人工确认」—— 于是「需要人逐条看」归零，
 * **下次再冒出新的跨章声明才是信号**。
 *
 * ## 为什么它需要一个门禁
 *
 * 台账按 **(book, ch, event)** 记账，而三样都会变：
 *   · `ch` 会变（条目重新分章 / 删条目）
 *   · `event` 会变（事件改名 / 合并 / 删除 —— 见 v0.159 雷同合并的教训）
 *   · 条目 `events[]` 会变（这正是 A2/A3 每天在动的东西）
 * 一旦漂移，台账条目就**永远不会被读到**（消费方按 `章号|事件id` 查），
 * 而它看起来还好好待着 —— "没生效的豁免清单比没有清单更坏"（v0.97 的教训）。
 *
 * ## 判据（**不需要原著文本**，所以能进 CI）
 *
 *   L1  顶层是数组
 *   L2  每条是 `{book, ch, event, why}`：book 非空串 / ch 正整数 / event 非空串
 *   L3  `why` 非空且 ≥ 8 字（理由栏 —— 与 kin-terms-exempt 同一先例）
 *   L4  `book` 存在（`data/<book>.json` 与 `data/annotations/<book>.json` 都在）
 *   L5  该章（`ch`）**有**至少一个条目
 *   L6  `event` 在该书 `events` 里存在
 *   L7  该章至少一个条目的 `events[]` **含**该 event —— 否则消费方永远读不到这条（死条目）
 *   L8  `event` 的章号**确实 ≠** 台账的 `ch` —— 否则它已不再是跨章声明 ⇒ 台账过期、自相矛盾
 *   L9  同一 `book|ch|event` 不重复
 *   L10 **双向**：数据里实际存在的跨章声明（`scripts/lib/anno-cross-chapter.mjs`
 *       的 `crossChapterDeclarations`）**每一条都要在台账里** —— 否则就是「新冒出来的、
 *       还没核」，报出来逼人去读原著
 *
 * ⚠ L10 与审计脚本共用 `anno-cross-chapter.mjs` 的**同一份定义**（不抄第二遍）。
 *
 * 用法：node scripts/check-cross-chapter-ledger.mjs
 *
 * ⚠ 支持 `BOOKATLAS_ROOT` 环境变量（**只给测试用**，与 check-missing-ok.mjs 同一写法）；
 *   并且导出 `checkCrossChapterLedger(root)`，守卫测试可以直接在进程内跑（不起子进程）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crossChapterDeclarations, loadBookPair } from './lib/anno-cross-chapter.mjs';

const DEFAULT_ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function checkCrossChapterLedger(root = DEFAULT_ROOT) {
  const problems = [];
  const LEDGER = path.join(root, 'data', 'cross-chapter-ok.json');
  if (!fs.existsSync(LEDGER)) return problems;          // 没有台账 = 没有已核条目，不算错

  let list;
  try { list = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); }
  catch (e) { return [`data/cross-chapter-ok.json：JSON 解析失败 —— ${e.message}`]; }
  if (!Array.isArray(list)) return ['data/cross-chapter-ok.json：顶层必须是数组（消费方直接遍历它）'];

  /* 每本书只加载一次 */
  const pairs = new Map();
  const pairOf = (book) => {
    if (!pairs.has(book)) pairs.set(book, loadBookPair(book, root));
    return pairs.get(book);
  };

  const seen = new Map();
  const ledgerKeys = new Set();

  for (const [i, e] of list.entries()) {
    const at = `data/cross-chapter-ok.json 第 ${i + 1} 条`;

    /* L2 形状 */
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      problems.push(`${at}：不是 \`{book, ch, event, why}\` 对象（${JSON.stringify(e).slice(0, 60)}）`);
      continue;
    }
    if (typeof e.book !== 'string' || !e.book.trim()) { problems.push(`${at}：\`book\` 缺失或为空`); continue; }
    if (!Number.isInteger(e.ch) || e.ch < 1) { problems.push(`${at}（${e.book}）：\`ch\` 必须是正整数（拿到 ${JSON.stringify(e.ch)}）`); continue; }
    if (typeof e.event !== 'string' || !e.event.trim()) { problems.push(`${at}（${e.book} ch${e.ch}）：\`event\` 缺失或为空`); continue; }

    const key = `${e.book}|${e.ch}|${e.event}`;
    /* L9 去重 */
    if (seen.has(key)) { problems.push(`${at}：与第 ${seen.get(key)} 条重复（${key}）`); continue; }
    seen.set(key, i + 1);
    ledgerKeys.add(key);

    /* L3 理由栏 */
    const why = String(e.why || '');
    if (why.trim().length < 8) {
      problems.push(`${at}（${key}）：\`why\` ${why.trim() ? '不足 8 字' : '为空'} —— 台账条目必须写明「为什么这是有意的跨章声明」+ 原文依据`);
      continue;
    }

    /* L4 书存在 */
    const pair = pairOf(e.book);
    if (!pair) {
      problems.push(`${at}（${key}）：找不到 \`data/${e.book}.json\` 或 \`data/annotations/${e.book}.json\` ⇒ 这本书不存在（改名了？删了？）`);
      continue;
    }
    const { A, B } = pair;
    const items = A.items || [];

    /* L5 该章有条目 */
    const sameCh = items.filter((it) => it.ch === e.ch);
    if (!sameCh.length) {
      problems.push(`${at}（${key}）：《${e.book}》里**没有 ch = ${e.ch} 的条目** ⇒ 台账条目是死的（条目被删了？重新分章了？）`);
      continue;
    }

    /* L6 事件存在 */
    const ev = (B.events || []).find((x) => x.id === e.event);
    if (!ev) {
      problems.push(`${at}（${key}）：《${e.book}》的事件表里没有 \`${e.event}\` ⇒ 台账条目是死的（事件改名 / 合并 / 删除了？）`);
      continue;
    }

    /* L7 该章至少一个条目声明了它 */
    if (!sameCh.some((it) => (it.events || []).includes(e.event))) {
      problems.push(`${at}（${key}）：\`ch\` = ${e.ch} 的条目**没有一个**在 \`events[]\` 里声明 \`${e.event}\` ⇒`
        + `\n     消费方按 \`章号|事件id\` 查，这条**永远不会被读到** —— 台账看着写了、实际不生效`
        + `\n     （若是有意撤掉声明，请把这条台账一起删掉）。`);
      continue;
    }

    /* L8 确实跨章 */
    const evCh = Number((String(ev.chapter ?? '').match(/\d+/) ?? String(ev.ch ?? '').match(/\d+/) ?? [NaN])[0]);
    if (evCh === e.ch) {
      problems.push(`${at}（${key}）：事件的章号**就是** ${e.ch} —— 它已不再是跨章声明`
        + `\n     ⇒ 这条台账过期且自相矛盾（台账只该收「章号 ≠ 本条 ch」的声明）。`);
    }
  }

  /* L10 双向：数据里实际的跨章声明，每一条都要在台账里 */
  const annoDir = path.join(root, 'data', 'annotations');
  if (fs.existsSync(annoDir)) {
    const books = fs.readdirSync(annoDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    for (const book of books) {
      const pair = pairOf(book);
      if (!pair) continue;
      for (const d of crossChapterDeclarations(book, pair.A, pair.B)) {
        const key = `${d.book}|${d.ch}|${d.event}`;
        if (!ledgerKeys.has(key)) {
          problems.push(`《${book}》ch${d.ch}「${d.itemTitle}」声明了跨章事件 \`${d.event}\`（第 ${d.eventCh} 回/章），**台账里没有它**`
            + `\n     ⇒ 新冒出来的跨章声明，还没回原著核过。核完请补进 \`data/cross-chapter-ok.json\`（写清 why + 原文依据）。`);
        }
      }
    }
  }

  return problems;
}

/* 入口判断用 pathToFileURL 规范化再比（别写 endsWith(process.argv[1])：
 * 本仓库目录名带空格，路径里的空格是 %20 编码，两边永远不相等 ⇒ 主流程一次都不跑、退出码还是 0）。 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ps = checkCrossChapterLedger();
  if (!ps.length) {
    console.log('✓ 跨章声明台账：形状 / 理由栏 / 引用完整性都对得上，且与数据**双向一致**（没有未核的跨章声明）');
    process.exit(0);
  }
  console.error(`✗ 跨章声明台账有 ${ps.length} 处问题：\n`);
  for (const p of ps) console.error('  ✗ ' + p);
  process.exit(1);
}
