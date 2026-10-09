/* 「噪声忽略名单」（`data/<slug>.missing-ok.json`）的**一致性**检查 —— v0.163 新增。
 *
 * ## 名单是什么
 *
 * `audit-against-text.mjs` 把原著正文里疑似人名的候选扫出来、与 `characters` 求差集。
 * 人判过"这确实不是人名"的候选，写进这份名单，下次不再报（否则工具天天报同样的噪声，
 * 很快就会被弃用）。消费方就是那一个脚本。
 *
 * 条目**两种形状都收**（纯字符串 / `{name, why}` 对象）—— 这是 v0.97 定下的，
 * 因为消费方早期只认字符串，往里加 `{name,why}` 后 `okSet.has('齐美尔')` 永远 false
 * ⇒ **名单看着写了、实际一条都不生效**（"没生效的忽略名单比没有名单更坏"）。
 *
 * ## 为什么它需要一个门禁
 *
 * 名单靠**名字**记账，而名字会变（建档 / 改名 / 删人 / 加别名都动它）。
 * 消费方的判据是「候选不在 `okSet` 里」；一旦名单里的名字**变成了真名**，那条目就
 * **永远不会被读到**（真名在候选提取前就被屏蔽了）—— 于是：
 *
 *   · 若它是**人物**的真名 / 别名 / 译名 ⇒ **自相矛盾**（名单自称"不是人名"，可数据里
 *     就有这个人）。更糟的是：**哪天这个人被改名 / 删掉，这条死条目会把他重新出现的
 *     候选静默吃掉**，缺口被永久藏起来 —— 正是名单 `_说明` 自己警告的那件事。
 *   · 若它是**地点**名 ⇒ 地点同样在候选提取前被屏蔽 ⇒ 这条目是**死的**（留着无害，但没用）。
 *
 * 实测现场（v0.163 本检查写完当场抓到）：`three-kingdoms` 里
 *   · 第 209 条 `车冑` —— 数据里 `che-zhou` 的**主名**就是车冑（别名车胄）
 *   · 第 276 条 `刘繇` —— 数据里 `liu-yao` 的主名就是刘繇
 * 而且那份文件的 `_说明` 还写着「书里确实还有些没建档的人（车冑、潘璋、严颜、张鲁…）」
 * —— 这**四个现在全在数据里**，那句话整体过期了。
 *
 * ## 判据（**不需要原著文本**，所以能进 CI）
 *
 *   M1  顶层是数组
 *   M2  每条要么是字符串、要么是 `{name, why}` 对象（**别的形状消费方会静默忽略**）
 *   M3  名字是非空字符串、且**不以 `_` 开头**（`_` 开头被消费方当说明行吞掉）
 *   M4  名字不重复
 *   M5  `{name, why}` 的 `why` 非空（理由栏）
 *   M6  名字**不得等于会被消费方屏蔽的名字**（人物 name/aliases/altNames、地点 name/aliases，长度 ≥2）
 *       —— 等于人物名是**矛盾**，等于地点名是**死条目**
 *   M7  有 `<slug>.missing-ok.json` 却没有 `<slug>.json`（孤儿名单）
 *   M8  这条**根本不是候选名字**：含散文标点、或长度 > 12 ⇒ 说明头漏了 `_` 前缀
 *       （v0.164 新增。实测《罪与罚》《三国》两份名单的 `_说明` 第二行就漏了前缀，
 *        整句 46~54 字被当成「已判过的噪声」塞进 okSet。M3 抓不到 —— 它只问
 *        「会不会被吞」，不问「这条是不是根本不是名字」。阈值依据：三本书真实条目
 *        **最长 5 字**、中位数 2~3、零标点；全历史 9 个快照回归 ⇒ 只命中那两处，零误伤）
 *
 * ⚠ **一条刻意不做的判据**：不检查「名字是不是某个真人名字的**子串**」——
 *   名单 `_说明` 的收录口径 ③ 明确**允许**"属于已有人物的别名或全名片段"
 *   （如「罗曼妲」＝尼格罗曼妲的名）。只有**完全相等**才是矛盾。
 *
 * 用法：node scripts/check-missing-ok.mjs
 *
 * ⚠ 支持 `BOOKATLAS_ROOT` 环境变量（**只给测试用**，与 check-name-form-ledger.mjs 同一写法）：
 *   test/missing-ok-guard.mjs 在 tmp 里造一份最小 data/，把 ROOT 指过去逐场景断言退出码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

export function checkMissingOk() {
  const problems = [];
  const files = fs.readdirSync(DATA).filter((f) => f.endsWith('.missing-ok.json')).sort();
  if (!files.length) return problems;

  for (const mf of files) {
    const slug = mf.replace(/\.missing-ok\.json$/, '');
    const bookFile = path.join(DATA, `${slug}.json`);
    if (!fs.existsSync(bookFile)) {
      problems.push(`${mf}：找不到对应的 ${slug}.json ⇒ 这本书不存在（改名了？删了？）—— 名单成了孤儿文件`);
      continue;
    }

    let list;
    try { list = JSON.parse(fs.readFileSync(path.join(DATA, mf), 'utf8')); }
    catch (e) { problems.push(`${mf}：JSON 解析失败 —— ${e.message}`); continue; }
    if (!Array.isArray(list)) {
      problems.push(`${mf}：顶层必须是数组（消费方用 new Set(okRaw.map(...)) 直接吃它）`);
      continue;
    }

    const book = JSON.parse(fs.readFileSync(bookFile, 'utf8'));
    /* 会被消费方**屏蔽**的名字（长度 ≥2，与 audit-against-text.mjs 第 95~96 行一致） */
    const person = new Set();
    for (const c of book.characters || []) {
      for (const n of [c.name, ...(c.aliases || []), ...(c.altNames || [])]) {
        if (typeof n === 'string' && n.length >= 2) person.add(n);
      }
    }
    const place = new Set();
    for (const p of book.places || []) {
      for (const n of [p.name, ...(p.aliases || [])]) {
        if (typeof n === 'string' && n.length >= 2) place.add(n);
      }
    }

    const seen = new Map();
    /* M8 的阈值：含散文标点、或长度 > 12 ⇒ 这不是候选名字，多半是说明头漏了 `_`。
     * 依据见头部：真实条目最长 5 字，缺陷条目 46~54 字。 */
    const PROSE = /[：。；！？，]/;
    const MAX_NAME = 12;
    const judge = (name, at, hint) => {
      if (typeof name !== 'string' || !name.trim()) { problems.push(`${at}：名字缺失或为空`); return; }
      if (PROSE.test(name) || [...name].length > MAX_NAME) {
        problems.push(`${at}：「${name.slice(0, 40)}${name.length > 40 ? '…' : ''}」**根本不是候选名字**`
          + `（含散文标点或长度 ${[...name].length} > ${MAX_NAME}）`
          + `\n     ⇒ 多半是名单开头的说明头**漏了 \`_\` 前缀**：消费方会把整句当成一条`
          + `\n       「已判过的噪声」塞进 okSet —— 正是这份名单 _说明 自己警告的那件事`
          + `\n       （"没人知道它已经判过了"）。`
          + `\n     改法：给那一行补上 \`_\` 前缀；真要忽略一个长串，请写 {name, why} 并确认它不是整句说明。`);
        return;
      }
      if (name.startsWith('_')) {
        problems.push(`${at}：名字以 \`_\` 开头（「${name}」）—— 消费方会把它当**说明行**吞掉，这条静默失效`);
        return;
      }
      if (seen.has(name)) problems.push(`${at}：与第 ${seen.get(name)} 条重复（「${name}」）`);
      else seen.set(name, at.replace(/^.*?第 (\d+) 条$/, '$1'));

      if (person.has(name)) {
        problems.push(`${at}：忽略条目「${name}」**恰好是数据里某个人物的名字**（name / aliases / altNames）`
          + `\n     ⇒ 名单自称"实测确认不是人名"，可数据里就有这个人 —— **自相矛盾**；`
          + `\n       而且这条目**永远不会被读到**（真名在候选提取前就被屏蔽了）。`
          + `\n       ⚠ 哪天这个人被改名 / 删掉，它还会把这个名字重新冒出来的候选**静默吃掉**。`
          + (hint ? `\n       ${hint}` : ''));
      } else if (place.has(name)) {
        problems.push(`${at}：忽略条目「${name}」恰好是数据里某个**地点**的名字 —— 地点同样在候选提取前被屏蔽`
          + `\n     ⇒ 这条目是**死的**（永远不会被读到）。若它确实是地名，删掉这条即可。`);
      }
    };

    for (const [i, e] of list.entries()) {
      const at = `${mf} 第 ${i + 1} 条`;
      if (typeof e === 'string') {
        if (e.startsWith('_')) continue;                 // 说明行
        judge(e, at);
      } else if (e && typeof e === 'object' && !Array.isArray(e)) {
        const why = String(e.why || '');
        judge(e.name, at, `（该条是 \`{name,why}\` 对象，理由：${why.slice(0, 40)}${why.length > 40 ? '…' : ''}）`);
        if (!why.trim()) problems.push(`${at}（${e.name}）：\`why\` 为空 —— 对象条目必须写明理由（理由栏）`);
      } else {
        problems.push(`${at}：不是字符串、也不是 \`{name,why}\` 对象（${JSON.stringify(e).slice(0, 60)}）`
          + `\n     ⇒ 消费方会**静默忽略**它（v0.97 踩过：名单看着写了、实际一条都不生效）。`);
      }
    }
  }

  return problems;
}

/* 入口判断用 pathToFileURL 规范化再比（别写 endsWith(process.argv[1])：
 * 本仓库目录名带空格，路径里的空格是 %20 编码，两边永远不相等 ⇒ 主流程一次都不跑、退出码还是 0）。 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ps = checkMissingOk();
  if (!ps.length) {
    console.log('✓ 噪声忽略名单：形状 / 去重 / 理由栏都对得上，且没有"恰好等于真名"的死条目');
    process.exit(0);
  }
  console.error(`✗ 噪声忽略名单有 ${ps.length} 处问题：\n`);
  for (const p of ps) console.error('  ✗ ' + p);
  process.exit(1);
}
