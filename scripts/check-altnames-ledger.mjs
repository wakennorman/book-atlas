/* 「又译出处台账」与数据的**双向一致性**检查 —— v0.161 新增。
 *
 * ## 台账是什么
 *
 * `data/<slug>.altnames-sources.json` 记录每个人物 `altNames`（界面上显示为「又译 X」）
 * 的**出处**。它自己的 `_说明` 写着一条铁律：
 *
 *     「查不到出处的**一个字都不许写**。译名不能凭记忆填 ——
 *       写错一个译名比不写更糟，读者会以为那是个错误的人名。」
 *
 * 结构：`{_说明, 本书采用的译本, altNames 计数, 来源{S1..S5}, 明细:[{人物,又译[],出处}],
 *        已拒绝的候选:[{又译,页面挂在,拒绝理由}]}`。
 *
 * ## 为什么它需要一个门禁
 *
 * **它没有任何消费者。** 全仓搜 `altnames-sources`，只有 `scripts/lib/data-files.mjs`
 * 的 SIDECAR 正则（用来把它排除出"书"）和一句注释 —— 也就是说：
 * 它漂了、漏了、写错了，**没有任何一处会响**。
 *
 * 实测（本检查写完当场抓到，两处）：
 *   · `何塞·阿尔卡蒂奥（第二代）`：数据里是「霍塞·阿卡迪奥」，
 *     台账写的是「霍塞·阿卡迪奥第二」—— 那是**修正前的旧值**
 *     （CHANGELOG 记着：黄锦炎译本靠"带不带姓"区分父子，光杆的是儿子；
 *      那次把「霍塞·阿卡迪奥第二」从第二代身上挪走了，台账没跟着改）。
 *   · `布鲁诺·克雷斯皮`：数据里有 `altNames: ["布鲁诺·克雷斯比"]`，
 *     台账**根本没有这一条**（v0.96 建人物时带入，v0.97 建台账时只登记了那一轮新增的 26 条）。
 *
 * 而且它自己的 `altNames 计数: 26` 与数据的 **27** 对不上 ——
 * 又是「两个数字都印在文件里、差 1、没人报过」（v0.155 / v0.156 / v0.160 同一族）。
 *
 * ## 判据（**不需要原著文本**，所以能进 CI）
 *
 *   A1  顶层是对象、且 `明细` 是数组
 *   A2  `明细[].人物` 必须是数据里真实存在的人物名
 *   A3  `明细[].又译` 必须是非空字符串数组、无空串、无重复
 *   A4  `明细[].出处` 必须是 `来源` 里定义过的键
 *   A5  **逐人双向比对**：数据里该人的 `altNames` 集合 ⇄ 台账该人的 `又译` 集合，必须完全相同
 *       （这条是主力：本次两处漂移都是它抓的）
 *   A6  `altNames 计数` 必须等于数据里 altNames 的实际总数
 *   A7  `明细[].人物` 不得重复
 *   A8  `已拒绝的候选[]` 每条必须有非空的 `又译` 与 `拒绝理由`
 *
 * ⚠ **一条被否掉的判据**（记下来别再写）：
 *   「已拒绝的候选里的 `又译` 不得出现在数据的 `altNames` 里」—— 看起来天经地义，**会误报**。
 *   `已拒绝的候选` 里有一条 `小邦迪亚／邦迪亚上校`，拒绝理由写的是
 *   「S1 已给出「邦迪亚上校」，出处等级高于维基，**不重复登记**」——
 *   也就是说 `邦迪亚上校` **本来就在数据里**（由 S1 覆盖）。
 *   「拒绝」在这里指"不再登记进 `明细`"，不等于"不进数据"。
 *
 * 用法：node scripts/check-altnames-ledger.mjs
 *
 * ⚠ 支持 `BOOKATLAS_ROOT` 环境变量（**只给测试用**，与 check-name-form-ledger.mjs 同一写法）：
 *   test/altnames-ledger-guard.mjs 在 tmp 里造一份最小 data/，把 ROOT 指过去逐场景断言退出码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

export function checkAltnamesLedgers() {
  const problems = [];
  const files = fs.readdirSync(DATA).filter((f) => f.endsWith('.altnames-sources.json')).sort();
  if (!files.length) return problems;

  for (const lf of files) {
    const slug = lf.replace(/\.altnames-sources\.json$/, '');
    const bookFile = path.join(DATA, `${slug}.json`);
    if (!fs.existsSync(bookFile)) {
      problems.push(`${lf}：找不到对应的 ${slug}.json ⇒ 这本书不存在（改名了？删了？）—— 台账成了孤儿文件`);
      continue;
    }

    let led;
    try { led = JSON.parse(fs.readFileSync(path.join(DATA, lf), 'utf8')); }
    catch (e) { problems.push(`${lf}：JSON 解析失败 —— ${e.message}`); continue; }
    if (!led || typeof led !== 'object' || Array.isArray(led) || !Array.isArray(led.明细)) {
      problems.push(`${lf}：顶层必须是对象、且 \`明细\` 是数组（读它的人靠这两条找内容）`);
      continue;
    }

    const book = JSON.parse(fs.readFileSync(bookFile, 'utf8'));
    const byName = new Map((book.characters || []).map((c) => [c.name, c]));
    const sources = new Set(Object.keys(led.来源 || {}));

    /* 数据里 altNames 的实际总数（A6 用） */
    let dataTotal = 0;
    for (const c of book.characters || []) dataTotal += (c.altNames || []).length;

    /* ---- 明细 ---- */
    const seenPerson = new Map();
    const covered = new Set();
    for (const [i, e] of led.明细.entries()) {
      const at = `${lf} 明细第 ${i + 1} 条`;
      if (!e || typeof e !== 'object' || Array.isArray(e)) { problems.push(`${at}：不是 \`{人物,又译,出处}\` 对象`); continue; }
      const person = String(e.人物 ?? '');
      if (!person.trim()) { problems.push(`${at}：\`人物\` 为空`); continue; }
      if (seenPerson.has(person)) problems.push(`${lf}：「${person}」在明细里重复（第 ${seenPerson.get(person)} 条与第 ${i + 1} 条）`);
      else seenPerson.set(person, i + 1);
      covered.add(person);

      const alts = e.又译;
      if (!Array.isArray(alts) || !alts.length) { problems.push(`${at}（${person}）：\`又译\` 必须是非空数组`); continue; }
      const bad = alts.filter((x) => typeof x !== 'string' || !x.trim());
      if (bad.length) problems.push(`${at}（${person}）：\`又译\` 里有空值 —— ${JSON.stringify(bad)}`);
      const dup = alts.filter((x, k) => alts.indexOf(x) !== k);
      if (dup.length) problems.push(`${at}（${person}）：\`又译\` 内部重复 —— ${[...new Set(dup)].join('、')}`);
      if (e.出处 !== undefined && !sources.has(String(e.出处))) {
        problems.push(`${at}（${person}）：\`出处\` 写的是「${e.出处}」，不在 \`来源\` 里（${[...sources].join('/')}）`);
      }

      const c = byName.get(person);
      if (!c) {
        problems.push(`${lf}：「${person}」不是数据里的人物名 ⇒ 台账指向**不存在的人**（改名/删人后没同步？）`);
        continue;
      }
      /* A5：双向比对 */
      const ledSet = new Set(alts.filter((x) => typeof x === 'string'));
      const datSet = new Set(c.altNames || []);
      const dataOnly = [...datSet].filter((x) => !ledSet.has(x));
      const ledOnly = [...ledSet].filter((x) => !datSet.has(x));
      if (dataOnly.length) {
        problems.push(`${lf}：「${person}」的数据里有 altName 但台账**没登记** —— ${JSON.stringify(dataOnly)}`
          + `\n     ⇒ 台账的铁律是"查不到出处的一个字都不许写"；这条没有出处记录，`
          + `要么补出处，要么把它从数据的 altNames 里去掉。`);
      }
      if (ledOnly.length) {
        problems.push(`${lf}：「${person}」的台账登记了但数据里**没有** —— ${JSON.stringify(ledOnly)}`
          + `\n     ⇒ 多半是改了数据没改台账（本次那两条就是这么漂的）。`);
      }
    }

    /* ---- 数据里有 altNames 却完全不在明细里 ---- */
    for (const c of book.characters || []) {
      if ((c.altNames || []).length && !covered.has(c.name)) {
        problems.push(`${lf}：数据里「${c.name}」有 altNames ${JSON.stringify(c.altNames)}，`
          + `但明细里**没有这个人**的条目 ⇒ 又译没有出处记录`);
      }
    }

    /* ---- A6 计数 ---- */
    if (typeof led['altNames 计数'] === 'number' && led['altNames 计数'] !== dataTotal) {
      problems.push(`${lf}：\`altNames 计数\` 写 ${led['altNames 计数']}，数据实际 ${dataTotal} 个`
        + `\n     ⇒ 两个数字都印在文件里，对不上就是漂了（明细合计 ${led.明细.reduce((a, e) => a + ((e && e.又译) || []).length, 0)} 个）。`);
    }

    /* ---- A8 已拒绝的候选 ---- */
    const rej = led['已拒绝的候选'];
    if (rej !== undefined) {
      if (!Array.isArray(rej)) problems.push(`${lf}：\`已拒绝的候选\` 不是数组`);
      else for (const [i, e] of rej.entries()) {
        const at = `${lf} 已拒绝的候选第 ${i + 1} 条`;
        if (!e || typeof e !== 'object') { problems.push(`${at}：不是对象`); continue; }
        if (!String(e.又译 ?? '').trim()) problems.push(`${at}：\`又译\` 为空`);
        if (!String(e.拒绝理由 ?? '').trim()) problems.push(`${at}（${e.又译}）：\`拒绝理由\` 为空 —— 拒绝也要留理由`);
      }
    }
  }

  return problems;
}

/* 入口判断用 pathToFileURL 规范化再比（别写 endsWith(process.argv[1])：
 * 本仓库目录名带空格，路径里的空格是 %20 编码，两边永远不相等 ⇒ 主流程一次都不跑、退出码还是 0）。 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ps = checkAltnamesLedgers();
  if (!ps.length) {
    console.log('✓ 又译出处台账：明细与数据的 altNames 逐人一致，计数 / 出处 / 理由都对得上');
    process.exit(0);
  }
  console.error(`✗ 又译出处台账有 ${ps.length} 处问题：\n`);
  for (const p of ps) console.error('  ✗ ' + p);
  process.exit(1);
}
