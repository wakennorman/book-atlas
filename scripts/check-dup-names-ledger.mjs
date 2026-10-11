#!/usr/bin/env node
/**
 * `data/dup-names-ok.json`（「去括号后同名」已核台账）的门禁 —— v0.181 新增。
 *
 * ## 这份台账是什么
 *
 * `scripts/audit-search.mjs` 的 ④ 桶列出「去掉括号补充后名字相同的多个人物」，
 * 它**分不清**两种情况：① 同一人被拆成两条记录；② 真有两个同名的人。
 * 人回原著逐条读完之后：① 合并，② 每个主名都补上括号并登记进本台账。
 *
 * v0.181 逐条读完了三本书的全部 ④ 组（**7 + 1 + 0 = 8 组**），结论是**全部真重名**
 * —— 但这不代表 ④ 从此不用看了：以后再加一个人进来，④ 还是会报新的组。
 * 这就是本台账存在的意义：**把「已核过的」记下来，让门禁只报没记过的那几组。**
 *
 * ## 为什么必须守（与 v0.160–163 / 177–179 同一族）
 *
 * 台账按 **`(book, base)`** 记账，而 `base`（去括号后的主名）与 `members`
 * （人物 id 列表）**全都是会变的**：改名、补括号、合并、删人，都动它们。
 * 消费方是审计的 ④ 桶，而它**按当前数据重新分组** ⇒ 台账一旦与数据脱节，
 * 它要么静默失效（该报的新组没人管），要么指向一组已经不存在的人
 * （读它的人以为「这组已经核过了」，其实数据早就不是那组了）。
 *
 * 这一族此前已抓到 7 处存量漂移（`诸葛珪`/`戴陵`/`车冑`/`刘繇`/`何塞·阿尔卡蒂奥` 等），
 * 所以**不守＝默认它会漂**。
 *
 * ## ⚠ 为什么判定规则放 `scripts/lib/dup-names.mjs` 而不是从审计脚本 import
 *
 * `audit-search.mjs` 是**顶层就干活**的脚本：`import` 它会把主流程也跑一遍，
 * 而它开头 `if (!files.length) { … process.exit(1) }` —— 门禁 import 它时
 * `process.argv` 是门禁自己的，`files` 必为空 ⇒ **门禁直接被 exit 1 掉**。
 * 抄第二份规则的后果本仓库吃过四次（见 `scripts/lib/data-files.mjs` 的注释）：
 * 定义漂移之后，门禁与审计各算各的 —— 两边都绿，而其中一个已经不认识这批数据了。
 *
 * ## 判据
 *
 * | # | 判据 |
 * |---|---|
 * | L1 | 台账不存在 ⇒ 0 处问题（可选文件）。存在则顶层形状合法 |
 * | L2 | 每条必须是对象，`book`/`base` 非空，`members` 是 ≥2 个不重复 id 的非空数组，`why` 是字符串 |
 * | L3 | `why` 去掉空白后 **≥ 8 字** |
 * | L4 | `book` 必须存在（`data/<book>.json` 可读） |
 * | L5 | `base` 必须**确实**在数据里构成一组撞车（≥2 人）—— 否则它已不是 ④ 组，台账过期 |
 * | L6 | `members` 里每个 id 都必须是**该组真实成员**（`baseName(c.name) === base`）—— 台账指向组外的人 |
 * | L7 | 台账 `members` 与数据实际成员**完全相等**（多记＝漂移，少记＝有人没核过） |
 * | L8 | 同一 `(book, base)` 不许重复 |
 * | L9 | **双向**：数据里现在每一组 ④ 撞车都必须在台账里（新冒出来的报红） |
 * | L10 | 组成员的主名**必须都带括号** —— 本项目的约定是「同名多人必须带括号区分」，不带括号的组说明改名没做完 |
 *
 * **L1–L10 全部只读 `data/`**，不需要原著 ⇒ 能在 CI 上真跑。
 * 「这组到底该不该判成真重名」是**人工回原著**的判断，本门禁管不了，也不管。
 *
 * ## 已知限制（必须打印，不能假装它是硬门禁）
 *
 * 本门禁**只保证台账与数据同步**，不保证「判断是对的」。
 * 换句话说：一个人可以给一堆组填上像模像样的 `why`，本门禁照样全绿。
 * 真正的把关是 v0.181 那一次逐条回原著 —— 那是人工动作，本门禁替代不了。
 *
 * 用法：`node scripts/check-dup-names-ledger.mjs`
 *
 * ⚠ 支持 `BOOKATLAS_ROOT`（**只给测试用**，与 check-first-ch-ledger.mjs 同一写法）：
 *   test/dup-names-ledger-guard.mjs 在 tmp 里造最小 data/，把 ROOT 指过去逐场景断言。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { baseName, dupeGroups } from './lib/dup-names.mjs';

export const DEFAULT_ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LEDGER_REL = 'data/dup-names-ok.json';

const nospace = (s) => String(s ?? '').replace(/\s/g, '');

/** 主名是否带括号补充 —— 「（…」或「(...)」都算。本项目约定的「同名多人必须带括号」就靠它。 */
export const hasParen = (s) => /[（(]/.test(String(s || ''));

/**
 * 把台账读成 `Map<'book|base', {members:Set<string>, why:string}>`。
 * 形状两种都收：纯数组，或 `{_说明…, 申报组数, 明细:[…]}`（口径与 check-name-form-ledger 一致）。
 * 形状不对时返回 `{error}` 而不是抛 —— 门禁要把「文件坏了」也报成红。
 */
export function readLedger(root = DEFAULT_ROOT) {
  const lf = path.join(root, LEDGER_REL);
  if (!fs.existsSync(lf)) return { missing: true, entries: new Map(), declared: null };
  let doc;
  try { doc = JSON.parse(fs.readFileSync(lf, 'utf8')); }
  catch (e) { return { error: `${LEDGER_REL} 不是合法 JSON：${e.message}` }; }

  const isPlainArray = Array.isArray(doc);
  const list = isPlainArray ? doc : (Array.isArray(doc.明细) ? doc.明细 : null);
  if (!list) return { error: `${LEDGER_REL} 既不是数组、也没有 \`明细\` 数组 ⇒ 门禁读不到任何条目` };

  const declared = (doc && typeof doc === 'object' && !isPlainArray && typeof doc.申报组数 === 'number')
    ? doc.申报组数 : null;

  const entries = new Map();
  /* ⚠ 每条都要带一个 `errors` 数组，**不能**只把错误挂在 `error` 字段上：
   *   重复登记（L8）与形状错误（L2/L3）都发生在一条**合法**的条目上，
   *   把错误写进 `error` 会让它在主循环里被当成「坏条目」整条跳过 ——
   *   而它同时还带着 members/why，主循环照常跑完、**L8 一个字都不报**。
   *   （v0.181 当场踩到：守卫里 `['L8 重复登记']` 那条用例恒绿。） */
  list.forEach((e, i) => {
    const at = `${LEDGER_REL}[${i}]`;
    const push = (msg) => {
      const cur = entries.get(`__idx__${i}`);
      if (cur) cur.errors.push(msg);
    };
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      entries.set(`__idx__${i}`, { errors: [`L2 ${at} 不是对象`], skip: true, i });
      return;
    }
    const { book, base, members, why } = e;
    entries.set(`__idx__${i}`, { errors: [], i, book, base, members: Array.isArray(members) ? members : null });
    if (typeof book !== 'string' || !book.trim()) push(`L2 ${at} book 必须是非空字符串`);
    if (typeof base !== 'string' || !base.trim()) push(`L2 ${at} base 必须是非空字符串`);
    if (typeof why !== 'string') push(`L2 ${at} why 必须是字符串`);
    else if (nospace(why).length < 8) push(`L3 ${at} why 去掉空白后只有 ${nospace(why).length} 字（要求 ≥8）—— 理由太短等于没写`);
    if (!Array.isArray(members) || members.length < 2) {
      push(`L2 ${at} members 必须是 ≥2 个 id 的数组（一组至少两个人）`);
    } else if (members.some((m) => typeof m !== 'string' || !m.trim())) {
      push(`L2 ${at} members 里必须全是非空字符串 id`);
    } else if (new Set(members).size !== members.length) {
      push(`L2 ${at} members 里有重复 id：${JSON.stringify(members)}`);
    }

    const rec = entries.get(`__idx__${i}`);
    if (rec.skip) return;
    if (typeof book !== 'string' || !book.trim() || typeof base !== 'string' || !base.trim()
      || !Array.isArray(members) || members.some((m) => typeof m !== 'string' || !m.trim())) {
      rec.skip = true;                 /* 键或成员不完整，L8/L5/L6/L7 都无从谈起 */
      return;
    }

    /* ── L8 重复登记 ── */
    const key = `${book}|${base}`;
    const prev = entries.get(key);
    if (prev) {
      const msg = `L8 ${at} 与第 ${prev.i + 1} 条重复登记 ${key} —— 同一组只能有一条结论`;
      prev.errors.push(msg);
      rec.errors.push(msg);
      return;                            /* 重复的那条不再参与 L5–L7 */
    }
    rec.key = key;
    entries.set(key, rec);
  });
  return { entries, declared, count: list.length };
}

/** 从 data/ 里把每本书当前的 ④ 组算出来（形状同 `dupeGroups`，多带上 book）。 */
export function currentGroups(root = DEFAULT_ROOT) {
  const dataDir = path.join(root, 'data');
  const out = [];
  if (!fs.existsSync(dataDir)) return { groups: out, books: [] };
  const files = fs.readdirSync(dataDir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.')
      && !/\.(graph|text|missing-ok|relayout|altnames-sources|name-form-ok|surname-blind-ok)\.json$/.test(f)
      && !/^(books|kin-terms-exempt|cross-chapter-ok|first-ch-ok|relation-actors-ok|dup-names-ok)\.json$/.test(f))
    .sort();
  const books = [];
  for (const f of files) {
    let book;
    try { book = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); }
    catch { continue; }
    const slug = f.replace(/\.json$/, '');
    books.push(slug);
    for (const g of dupeGroups(book.characters || [])) {
      out.push({
        book: slug, base: g.base,
        members: g.chars.map((c) => c.id),
        names: g.names,
      });
    }
  }
  return { groups: out, books };
}

export function checkDupNamesLedger(root = DEFAULT_ROOT) {
  const problems = [];
  const notes = [];
  const led = readLedger(root);
  if (led.error) return { problems: [led.error], notes };
  /* ⚠ **缺台账 ≠ 没问题。**
   * 其余台账（name-form-ok / first-ch-ok）可以「文件不存在 ⇒ 0 处问题」，
   * 因为它们的审计脚本**自己会报**，台账只是豁免清单。
   * 而本台账是另一回事：④ 报的每一组都**必须**在这里有结论（合并 或 登记）。
   * 若照抄「缺文件即跳过」，那么 `rm data/dup-names-ok.json` 就能让门禁全绿 ——
   * **删掉名单，问题就消失了**，这是最坏的一种假绿（v0.160 记的「没生效的名单比没有更坏」的镜像）。
   * ⇒ 缺台账时当作「空台账」继续跑：L9 会把每一组都报成「没登记」。
   * 数据里确实一组撞车都没有时（全新项目），空台账自然 0 处问题 —— 语义仍然自洽。 */
  if (led.missing) notes.push(`⚠ 没有 ${LEDGER_REL} —— 按**空台账**继续判（每一组 ④ 撞车都算「没登记」）`);

  /* 申报组数 vs 明细条数（口径与 name-form / first-ch 台账一致） */
  if (led.declared !== null && led.declared !== led.count) {
    problems.push(`${LEDGER_REL}：\`申报组数\` 写 ${led.declared}，明细实际 ${led.count} 条`);
  }

  const { groups } = currentGroups(root);
  const byKey = new Map(groups.map((g) => [`${g.book}|${g.base}`, g]));

  /* ── 台账 → 数据（L4–L8） ── */
  for (const e of led.entries.values()) {
    for (const m of e.errors) problems.push(m);      /* L2 / L3 / L8（无论它是否还有效） */
    if (e.skip || !e.key) continue;
    const { book, base } = e;
    const g = byKey.get(e.key);
    if (!g) {
      problems.push(`L5 ${e.key}：数据里现在**没有**这一组「${base}」—— 台账过期了`
        + `（组里的人被合并/改名了？）照着当前数据改，或删掉这条。`);
      continue;
    }
    const real = new Set(g.members);
    const got = e.members;
    const bad = got.filter((m) => !real.has(m));
    if (bad.length) {
      problems.push(`L6 ${e.key}：台账里的 ${bad.join('、')} 不在这一组里`
        + `（本组实为 ${g.names.join('、')}）—— 指向组外的人。`);
    }
    /* L7：集合相等即可（顺序不敏感），且只在「成员本身没写错」时才有意义 */
    const sameSet = got.length === g.members.length && bad.length === 0;
    if (!sameSet) {
      problems.push(`L7 ${e.key}：台账记的成员与数据不一致`
        + `\n     台账：${got.join('、')}\n     数据：${g.members.join('、')} —— 数据改过（改名/合并/新增）而台账没跟上。`);
    }
  }

  /* ── 数据 → 台账（L9 双向） ── */
  for (const g of groups) {
    const key = `${g.book}|${g.base}`;
    /* ⚠ 判「有没有登记」必须看 `key`，不能看 `led.entries.has(key)`：
     *   entries 里同时躺着 `__idx__N` 的中转键，`has()` 本身没问题，
     *   但 v0.181 第一版把**形状坏掉的条目**也塞进了 entries，
     *   于是「写坏了一条」反而让它变成"已登记" ⇒ L9 静默失效。
     *   现在形状坏掉的条目一律带 `skip`，不会进入 key 表。 */
    if (led.entries.has(key)) continue;
    problems.push(`L9 ${key}：数据里这一组「${g.base}」没进台账`
      + `（成员：${g.names.join('、')}）—— 回原著读一遍，判成同一人就合并，判成真重名就补括号并登记。`);
  }

  /* ── L10 每组都带括号 ── */
  for (const g of groups) {
    const bare = g.names.filter((n) => !hasParen(n));
    if (bare.length) {
      problems.push(`L10 ${g.book}|${g.base}：成员 ${bare.map((n) => `「${n}」`).join('、')} 的主名**没带括号**`
        + ` —— 本项目约定「同名多人必须带括号区分」，否则网页搜索分不开、validate 的「文案提到谁」会误判。`
        + `改法见 scripts/fix-dup-names.mjs（每条改名都必须带原著依据，否则它拒绝执行）。`);
    }
  }

  notes.push(`台账 ${led.count} 条；数据里当前 ${groups.length} 组 ④ 撞车`
    + `（${currentGroups(root).books.length} 本书）—— 双向都对得上。`);
  notes.push('⚠ 本门禁只管「台账与数据同步」；「这组到底该不该判成真重名」是人工回原著的判断，本门禁替代不了。');
  return { problems, notes };
}

/* 入口判断用 pathToFileURL 规范化再比（与 check-first-ch-ledger / check-name-form-ledger 同一写法）。
 * ⚠ 别写 `import.meta.url.endsWith(process.argv[1])` —— 本仓库目录名带空格，
 *   路径里的空格是 %20 编码 ⇒ 两边永远不相等，主流程一次都不跑而退出码还是 0
 *   —— 也就是「检查通过」其实是「检查没执行」（v0.177 记的坑）。 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { problems, notes } = checkDupNamesLedger();
  for (const n of notes) console.log(`  ${n}`);
  if (problems.length) {
    console.error(`\n✗ 去括号后同名台账：${problems.length} 处问题`);
    for (const p of problems) console.error(`   ${p}`);
    console.error('\n   ⇒ 台账按 (book, base) 记账，而 base 与 members 都会变 ⇒ 必须与数据同步。');
    process.exit(1);
  }
  console.log('\n✓ 去括号后同名台账：形状 / 理由 / 引用完整性 / 双向比对都对得上，且每组都带括号（L1–L10 全过）');
}