/* 「姓氏提取器盲区」的引用完整性检查 —— v0.164 新增。
 *
 * ## 盲区是什么
 *
 * `audit-against-text.mjs` 找「书里提到、数据里没有的人」靠**候选提取**：
 *   /[百家姓][\u4e00-\u9fa5]{1,2}/g   （`surnameRe`，见该脚本）
 * 也就是「姓氏字 + 1~2 个汉字」。提取不出来的人 ⇒ **即使真漏了也永远不会进缺口清单**，
 * 缺口清单因此「看着干净」。实测三本书有 **183 个主名**落在盲区里。
 *
 * 盲区的两种成因（都不是「数据错了」，是**工具的量程不够**）：
 *   ① 复姓 / 生僻姓 / 音译名：首字不在那张**单字**百家姓表里
 *      （三国实测 63 人：皇甫嵩、桥玄、审配、沮授、典韦、貂蝉、太史慈、淳于琼…）
 *   ② 全名太长：提取器只取 2~3 字，「何塞·阿尔卡蒂奥·布恩迪亚」这种整名产不出来
 *      （百年孤独 57 人、罪与罚 31 人；另有称谓型主名如「吴太夫人」「清河公主」）
 *
 * ⚠ 本检查**只把盲区显式化，不改提取器**：补复姓要动 `audit-against-text.mjs` 的行为，
 *   而仓库里没有原著文本（`.text/` 被 gitignore）⇒ 改完无法实测召回变化。
 *   要动提取器，先按 `docs/新书处理规程.md` §四 0.5/0.6 备好原文本地跑一次对比。
 *
 * ## 判据（**不需要原著文本**，所以能进 CI）
 *
 *   C0  能从 `audit-against-text.mjs` **解析出**提取规则；解析不到就报红
 *       —— 门禁与工具同源：规则变了（补复姓、放宽长度）这里自动跟着变，
 *          解析不到则**拒绝跑**而不是猜一套默认值（那会变成假绿）。
 *   C1  台账是数组，或 {_说明…, 明细:[…]}；`_` 开头的说明行不算条目
 *   C2  每条是 `{name, why}` 且 `why` 非空
 *   C3  `name` 不重复
 *   C4  `name` 指向**真实存在的主名**（别名 → 报红并指出主人；查无此人 → 报红）
 *   C5  `name` **确实产不出来**（可提取却豁免 ⇒ 这条豁免已过期，提示删）
 *   C6  `申报条数`（若写了）与明细条数一致
 *   C7  有台账却没有书文件（孤儿台账）
 *   C8  **反向**：书里每个产不出来的主名都必须在本台账里申报过（漏报 = 报红）
 *
 * 一句话：**这把「工具看不见的人」从隐形的变成有清单的**。新增人物若提取不了，
 * 门禁会红，逼着写清理由；提取器哪天放宽了，这些豁免会逐条报红过期 ⇒ 照着删。
 *
 * 用法：node scripts/check-surname-coverage.mjs
 *
 * ⚠ 支持 `BOOKATLAS_ROOT` 环境变量（**只给测试用**，与 check-name-form-ledger.mjs 同一写法）：
 *   test/surname-coverage-guard.mjs 在 tmp 里造最小 data/ + scripts/，把 ROOT 指过去逐场景断言。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/* 「data/ 里哪些是书」只有一个定义（scripts/lib/data-files.mjs，v0.155 起）——
   本脚本**不自己**读 books.json 再过滤，那正是"同一个定义抄多份"的第 N 例。
   v0.164 实测：新增 sidecar 后忘了登记进它的 SIDECAR 正则，books-registry 立刻报红。 */
import { listBookSlugs } from './lib/data-files.mjs';

const ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const LEDGER_SUFFIX = '.surname-blind-ok.json';

/** 从工具源码解析提取规则。**解析不到就抛** —— 不猜默认值（那是假绿的制造机）。 */
export function readExtractor(toolsFile = path.join(ROOT, 'scripts', 'audit-against-text.mjs')) {
  let src;
  try { src = fs.readFileSync(toolsFile, 'utf8'); }
  catch (e) { throw new Error(`读不到 ${toolsFile} —— ${e.message}`); }

  const mSur = /const\s+SURNAMES\s*=\s*'([^']*)'/.exec(src);
  if (!mSur) throw new Error('解析不到 `const SURNAMES = …`（工具写法变了？）');
  /* 源文件里这行是 `[\\u4e00-\\u9fa5]`：**双反斜杠**（模板字符串里要转义成一个），
   * 所以这里不去匹配反斜杠，只取长度区间那一段。 */
  const mRe = /const\s+surnameRe\s*=\s*new RegExp\(`\[\$\{SURNAMES\}\][^`]*?\{(\d+),(\d+)\}`/.exec(src);
  if (!mRe) throw new Error('解析不到 `surnameRe` 的长度区间（工具写法变了？）');
  const mNorm = /const\s+norm\s*=\s*\(s\)\s*=>.*?replace\(\/\[([^\]]*)\]\/g/.exec(src);
  if (!mNorm) throw new Error('解析不到 `norm` 的去字符类（工具写法变了？）');

  const strip = new Set();
  for (let i = 0; i < mNorm[1].length; i++) {
    const ch = mNorm[1][i];
    if (ch !== '\\') { strip.add(ch); continue; }
    const nxt = mNorm[1][++i];
    if (nxt === 's') { for (const w of [' ', '\t', '\n', '\r']) strip.add(w); continue; }
    throw new Error(`norm 字符类里出现不认识的转义 \\${nxt} —— 门禁必须跟着改，别猜`);
  }
  const minTail = Number(mRe[1]), maxTail = Number(mRe[2]);
  const surnames = new Set(mSur[1]);
  const norm = (s) => [...String(s || '')].filter((c) => !strip.has(c)).join('').toLowerCase();
  /** 与提取器同口径：姓氏字开头 + 尾长 min~max ⇒ 这个名字**产得出来** */
  const extractable = (n) => {
    const t = norm(n);
    return t.length >= 1 + minTail && t.length <= 1 + maxTail && surnames.has(t[0]);
  };
  return { surnames, minTail, maxTail, norm, extractable };
}

export function checkSurnameCoverage() {
  const problems = [];
  let rule = null;
  try { rule = readExtractor(); }
  catch (e) { return [`C0 提取规则解析失败：${e.message}\n     ⇒ 门禁与工具同源这条纪律就是为此刻准备的：宁可报红，不要猜一套默认值跑出假绿。`]; }

  for (const slug of listBookSlugs()) {
    const book = JSON.parse(fs.readFileSync(path.join(DATA, `${slug}.json`), 'utf8'));
    const chars = book.characters || [];
    const mainNames = new Set(chars.map((c) => c.name));
    const aliasOwner = new Map();
    let aliasBlind = 0;
    for (const c of chars) {
      for (const a of c.aliases || []) {
        if (typeof a !== 'string' || !a) continue;
        if (!aliasOwner.has(a)) aliasOwner.set(a, c.name);
        if (!rule.extractable(a)) aliasBlind++;
      }
    }
    const blind = [...mainNames].filter((n) => !rule.extractable(n));

    const lf = `${slug}${LEDGER_SUFFIX}`;
    const lPath = path.join(DATA, lf);
    if (!fs.existsSync(lPath)) {
      if (blind.length) {
        problems.push(`${lf}：书里有 ${blind.length} 个主名提取器产不出来，却**没有台账** ⇒ 这批人是隐形的`
          + `（真漏了也不会进缺口清单）。建台账并逐条写理由，或改提取器。`
          + `\n     例：${blind.slice(0, 5).join('、')}${blind.length > 5 ? ' …' : ''}`);
      }
      continue;
    }

    let ledger;
    try { ledger = JSON.parse(fs.readFileSync(lPath, 'utf8')); }
    catch (e) { problems.push(`${lf}：JSON 解析失败 —— ${e.message}`); continue; }
    const isPlain = Array.isArray(ledger);
    const list = isPlain ? ledger : (Array.isArray(ledger.明细) ? ledger.明细 : null);
    if (!list) {
      problems.push(`${lf}：既不是数组、也没有 \`明细\` 数组 ⇒ 台账会被消费方当成**空名单**，全部豁免失效`);
      continue;
    }
    if (!isPlain && typeof ledger.申报条数 === 'number' && ledger.申报条数 !== list.length) {
      problems.push(`${lf}：\`申报条数\` 写 ${ledger.申报条数}，明细实际 ${list.length} 条`);
    }

    const declared = new Map();
    for (const [i, e] of list.entries()) {
      if (typeof e === 'string' && e.startsWith('_')) continue;   // 说明行
      const at = `${lf} 第 ${i + 1} 条`;
      if (!e || typeof e !== 'object' || Array.isArray(e)) {
        problems.push(`${at}：不是 \`{name, why}\` 对象（说明行请用 \`_\` 开头的字符串）`);
        continue;
      }
      const name = String(e.name ?? '');
      const why = String(e.why ?? '');
      if (!name.trim()) { problems.push(`${at}：\`name\` 为空`); continue; }
      if (!why.trim()) problems.push(`${at}：「${name}」的 \`why\` 为空 —— 台账要求每条写明理由`);
      if (declared.has(name)) problems.push(`${at}：「${name}」重复申报（第 ${declared.get(name)} 条与第 ${i + 1} 条）`);
      else declared.set(name, i + 1);

      if (!mainNames.has(name)) {
        const owner = aliasOwner.get(name);
        problems.push(owner
          ? `${at}：「${name}」是 **${owner} 的别名**、不是主名 ⇒ 本台账只管主名（缺口检测按主名找人），这条**不生效**`
          : `${at}：「${name}」在书里查无此人 ⇒ 指向**不存在的人物**（多半是删人/改名后没同步台账）`);
        continue;
      }
      if (rule.extractable(name)) {
        problems.push(`${at}：「${name}」现在**提取器已经产得出来** ⇒ 这条豁免已过期`
          + `\n     （提取器放宽过，或当初判错了）。照着删掉它 —— 台账留垃圾条目就等于没人信它。`);
      }
    }

    /* C8 反向：漏报 */
    const missing = blind.filter((n) => !declared.has(n));
    if (missing.length) {
      problems.push(`${lf}：${missing.length} 个主名提取不出来但**没有申报** ⇒ 隐形的盲区`
        + `\n     ${missing.join('、')}`);
    }
    /* 台账里多申报了「其实产得出来」的，上面已逐条报红；这里再给一句统计，便于观察 */
    if (!problems.some((p) => p.startsWith(lf))) {
      console.log(`  ${slug}：主名 ${mainNames.size} 个，提取器可产出 ${mainNames.size - blind.length}，盲区豁免 ${declared.size}（别名盲区 ${aliasBlind} 条按设计不申报）`);
    }
  }

  /* C7 孤儿台账 */
  for (const f of fs.readdirSync(DATA).filter((f) => f.endsWith(LEDGER_SUFFIX))) {
    const slug = f.replace(new RegExp(`\\${LEDGER_SUFFIX}$`), '');
    if (!fs.existsSync(path.join(DATA, `${slug}.json`))) {
      problems.push(`${f}：找不到对应的 ${slug}.json ⇒ 这本书不存在（改名了？删了？）—— 台账成了孤儿文件`);
    }
  }

  return problems;
}

/* 入口判断用 pathToFileURL 规范化再比（别写 endsWith(process.argv[1])：
 * 本仓库目录名带空格，路径里的空格是 %20 编码，两边永远不相等 ⇒ 主流程一次都不跑、
 * 退出码还是 0 —— 也就是「检查通过」其实是「检查没执行」）。 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ps = checkSurnameCoverage();
  if (!ps.length) {
    console.log('✓ 提取器盲区台账：产不出来的主名都申报了理由，条目 / 唯一性 / 指向都对得上');
    process.exit(0);
  }
  console.error(`✗ 提取器盲区台账有 ${ps.length} 处问题：\n`);
  for (const p of ps) console.error('  ✗ ' + p);
  process.exit(1);
}
