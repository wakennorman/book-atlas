/* 「采用名字台账」的**引用完整性**检查 —— v0.160 新增。
 *
 * ## 台账是什么
 *
 * `data/<slug>.name-form-ok.json` 申报「主名不是原书原样字」的人物，每条 `{name, why}`。
 * 消费方是 `scripts/audit-against-text.mjs --names --strict`：
 * **申报过的人不再报错**（中文史传体「姓娄名子伯」「其父名河」这类全名从不连写的人，
 * 主名永远不可能是原样字，那条规矩对他们永远不成立）。
 *
 * ## 为什么它需要一个门禁
 *
 * 两个结构性弱点，而此前**没有任何一处守着**：
 *
 *   ① **按 `name` 记账**，而 `name` 是会变的 —— 改名 / 删人 / 合并都动它。
 *      人没了、名改了，台账条目还留在原地。
 *   ② 消费方是**按主名查**的：`declared.get(c.name)`。
 *      台账键写成别名 ⇒ 这条申报**根本不生效**，可它看起来还好好地待在那儿。
 *
 * 两类后果都不是"少一条记录"，而是**让下一个人白跑**：
 *   · 指向不存在的人 ⇒ 照着它回原文查，查不到，以为数据错了
 *   · 申报不生效   ⇒ 以为"这个人已经判过了"，其实每轮 `--names` 都还在报他
 *
 * ## 已经真的发生过 —— 本检查写完，当场抓到两条存量
 *
 * 那一刻的现场：`audit-against-text.mjs --names --strict` 打印
 * **「已申报 11 个」**，而台账文件自己写着 **`申报条数: 13`**。
 * **两个数字都印在文件里，差 2 条，却没有任何一处报过。**
 *
 *   · `诸葛珪`：v0.106（`scripts/fix-sun-geshi.mjs`）把它**连人一起删了**
 *     （原著「诸葛珪」0 次，见 `docs/known-dropped-relations.md`），
 *     台账条目从 v0.106 一直留到 v0.159 —— 9 个版本。
 *   · `戴陵`：数据里该人物的**主名是「戴凌」**（原著逐字出现 **16 次**，本来就是原样字），
 *     「戴陵」只是它的别名 ⇒ 台账键写成了别名 ⇒ 从 v0.128 起就没生效过。
 *     更麻烦的是它**连误报都没发生**（主名本来就在原文里）⇒ 它是一条**假记录**：
 *     读它的人会以为"原书不写这个全名"，而原书写了 16 次。
 *
 * ⚠ 这正是本项目反复踩的「**没生效的名单比没有更坏**」：
 *   名单在，人就不查了；而它其实什么都没挡。
 *
 * ## 判据（**不需要原著文本**，所以能进 CI）
 *
 * 原著不在仓库里（`docs/新书处理规程.md`：「⚠ 这一类错在版本库里查不出来」），
 * 所以本检查**只做引用完整性**，不判断"该不该申报"：
 *
 *   E1  台账键**既不是主名、也不是别名** ⇒ 指向不存在的人物
 *   E2  台账键**只出现在别名里**        ⇒ 申报不生效（消费方按主名查）
 *   E3  `申报条数` ≠ 明细条数
 *   E4  明细里有空的 `name` 或空的 `why`
 *   E5  明细里 `name` 重复
 *   E6  有 `data/<slug>.name-form-ok.json` 却没有 `data/<slug>.json`
 *   E7  台账既不是数组、也没有 `明细` 数组（消费方会当成空名单 ⇒ 申报全部失效）
 *
 * 「该不该申报」只能靠 `audit-against-text.mjs --names --strict`（要原著，本地跑）。
 * 两者**互补**：本检查管"台账还指不指得着人"，那条管"人有没有漏申报"。
 *
 * 用法：node scripts/check-name-form-ledger.mjs
 *
 * ⚠ 支持 `BOOKATLAS_ROOT` 环境变量（**只给测试用**，与 check-version-bump.mjs 同一写法）：
 *   test/name-form-ledger-guard.mjs 在 tmp 里造一份最小 data/，把 ROOT 指过去，
 *   逐场景断言退出码 —— 全程不碰真实仓库。判据"会不会报红"由那条测试常驻守着。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

export function checkNameFormLedgers() {
  const problems = [];

  /* 以 `data/` 下**真实存在**的台账为准，而不是 books.json ——
   * 只有这样才能抓到「书被删了/改名了、台账成了孤儿文件」（E6）。 */
  const files = fs.readdirSync(DATA).filter((f) => f.endsWith('.name-form-ok.json')).sort();
  if (!files.length) return problems;

  for (const lf of files) {
    const slug = lf.replace(/\.name-form-ok\.json$/, '');
    const bookFile = path.join(DATA, `${slug}.json`);
    if (!fs.existsSync(bookFile)) {
      problems.push(`${lf}：找不到对应的 ${slug}.json ⇒ 这本书不存在（改名了？删了？）—— 台账成了孤儿文件`);
      continue;
    }

    let ledger;
    try { ledger = JSON.parse(fs.readFileSync(path.join(DATA, lf), 'utf8')); }
    catch (e) { problems.push(`${lf}：JSON 解析失败 —— ${e.message}`); continue; }

    /* 形状两种都收：纯数组，或 `{_说明…, 明细:[…]}`。口径与 audit-against-text.mjs 一致
     * （那边为这事崩过一次：只认数组形状，遇到 `{明细}` 直接 `filter is not a function`，
     *   而"崩掉的红"和"检查不通过的红"在门禁里长得一样，极容易误判成"名单没生效"）。 */
    const isPlainArray = Array.isArray(ledger);
    const list = isPlainArray ? ledger : (Array.isArray(ledger.明细) ? ledger.明细 : null);
    if (!list) {
      problems.push(`${lf}：既不是数组、也没有 \`明细\` 数组 ⇒ 消费方会把它当成**空名单**，申报全部失效`);
      continue;
    }

    const book = JSON.parse(fs.readFileSync(bookFile, 'utf8'));
    const mainNames = new Set((book.characters || []).map((c) => c.name));
    const aliasOwner = new Map();
    for (const c of book.characters || []) {
      for (const a of c.aliases || []) if (!aliasOwner.has(a)) aliasOwner.set(a, c.name);
    }

    if (!isPlainArray && typeof ledger.申报条数 === 'number' && ledger.申报条数 !== list.length) {
      problems.push(`${lf}：\`申报条数\` 写 ${ledger.申报条数}，明细实际 ${list.length} 条`);
    }

    const seen = new Map();
    for (const [i, e] of list.entries()) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) {
        problems.push(`${lf}：第 ${i + 1} 条不是 \`{name, why}\` 对象`);
        continue;
      }
      const name = String(e.name ?? '');
      const why = String(e.why ?? '');
      if (!name.trim()) { problems.push(`${lf}：第 ${i + 1} 条的 \`name\` 为空`); continue; }
      if (!why.trim()) problems.push(`${lf}：「${name}」的 \`why\` 为空 —— 台账要求每条都写明理由`);
      if (seen.has(name)) problems.push(`${lf}：「${name}」重复申报（第 ${seen.get(name)} 条与第 ${i + 1} 条）`);
      else seen.set(name, i + 1);

      if (mainNames.has(name)) continue;
      const owner = aliasOwner.get(name);
      if (owner) {
        problems.push(`${lf}：「${name}」是 **${owner} 的别名**、不是主名 ⇒ 这条申报**不生效**`
          + `（audit-against-text.mjs 按 \`declared.get(c.name)\` 查，主名是「${owner}」）。`
          + `\n     改法：键改成主名「${owner}」；但先回原著搜一次主名 —— `
          + `若主名本就是原书原样字，那这条**不该存在**，直接删掉。`);
      } else {
        problems.push(`${lf}：「${name}」既不是任何人的主名、也不是任何人的别名 ⇒ 指向**不存在的人物**`
          + `（多半是删人/改名后没同步台账；规程原话：「删人不删台账，下一个人照着它去查会白跑」）。`
          + `\n     改法：删掉这条；若人还在、只是改了名，把键改成新主名。`);
      }
    }
  }

  return problems;
}

/* 入口判断用 pathToFileURL 规范化再比（与 check-graph-fields.mjs 同一写法）。
 * ⚠ 别写 `import.meta.url.endsWith(process.argv[1])` —— 前者带 `file:///` 前缀，
 *   而且本仓库目录名带空格（「Claude Code+DeepSeekV4」），路径里的空格是 **%20 编码**的
 *   ⇒ 两边永远不相等，主流程一次都不跑、退出码还是 0
 *   —— 也就是"检查通过"其实是"检查没执行"。这类静默失效最难发现。 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ps = checkNameFormLedgers();
  if (!ps.length) {
    console.log('✓ 采用名字台账：每条申报都指着一个真实存在的主名，条数 / 理由 / 唯一性都对得上');
    process.exit(0);
  }
  console.error(`✗ 采用名字台账有 ${ps.length} 处问题：\n`);
  for (const p of ps) console.error('  ✗ ' + p);
  process.exit(1);
}
