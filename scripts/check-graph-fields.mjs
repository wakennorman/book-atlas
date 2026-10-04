import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 网页端图包（data/<slug>.graph.json）的**字段覆盖检查**（v0.97 新增）。
 *
 * 为什么必须有这个检查 —— 它是被一个真实的"功能是死的"坑逼出来的：
 *   `altNames`（又译）从 v0.95 就接进了搜索/联想/人物卡/人物志/EPUB 导出，
 *   v0.97 还给它填了 27 条真实译名，
 *   而 `make-slim-packs.mjs` 的**字段白名单里漏了它** ⇒ 图包里 altNames 恒为 0
 *   ⇒ 浏览器里「又译」一条都显示不出来。
 *
 * 为什么门禁没抓到：`test/browser.mjs` 里那几条 altNames 断言用的是
 * **运行时注入的探针 altName**，根本没走数据通路 ——
 * 这是本项目反复踩到的同一族："测试用探针，于是真数据缺字段也照样绿"。
 * `make-slim-packs.mjs --check` 只能发现"忘了重新生成"，发现不了"白名单漏了字段"。
 *
 * 做法：**源数据的字段名集合 − 图包的字段名集合 − 显式的"故意不带"清单**。
 * 一旦有人给人物加了新字段却忘了同步，这里立刻红。
 * 所以 `GRAPH_OMITTED` 是一份**需要 consciously 决定**的清单：
 * 加新字段时，要么进图包，要么写进这份清单并说明理由 —— 不能默默消失。
 */

/* 人物上**故意不带**进图包的字段，以及理由。
 * ⚠ 别往这里塞"忘了同步"的字段 —— 那等于把问题永久藏起来。
 *    这份清单只放"确定永远不需要"的，且每条都要写清为什么。 */
const GRAPH_OMITTED = {
  parents: '**前端根本不读**（js/app.js 里 parents 出现 0 次）；它只服务 scripts/validate.mjs 的'
    + '族谱一致性检查，而那一步读的是 data/*.json 源文件，不是包。',
  _omitted: null,
};

/* 说明：title / desc / fate / note **故意**只在文案包里（体积大），
 * 由 app.js 的 attachText() 用 Object.assign 合并回来 —— 它们不算缺失，本检查也已按
 * 「两个包里都没有才算」的口径处理，所以不需要列进这里。 */

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');

export function checkGraphFieldCoverage() {
  const problems = [];
  const idx = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'books.json'), 'utf8'));
  const books = idx.books || [];

  for (const b of books) {
    const srcFile = path.join(DATA_DIR, `${b.slug}.json`);
    const graphFile = path.join(DATA_DIR, `${b.slug}.graph.json`);
    if (!fs.existsSync(srcFile) || !fs.existsSync(graphFile)) continue;

    const src = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
    const graph = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
    const textFile = path.join(DATA_DIR, `${b.slug}.text.json`);
    const text = fs.existsSync(textFile) ? JSON.parse(fs.readFileSync(textFile, 'utf8')) : null;
    if (!Array.isArray(src.characters) || !Array.isArray(graph.characters)) continue;

    /* 源数据里出现过的**全部**人物字段（并集，不是某一个角色的字段 ——
     * 只看第一个角色的话，只有第一个人才有的字段会被漏掉） */
    const srcFields = new Set();
    for (const c of src.characters) for (const k of Object.keys(c)) srcFields.add(k);
    const graphFields = new Set();
    for (const c of graph.characters) for (const k of Object.keys(c)) graphFields.add(k);
    const textFields = new Set();
    if (text && text.characters) for (const c of Object.values(text.characters)) for (const k of Object.keys(c)) textFields.add(k);

    /* ⚠ 判据是「**两个包里都没有**」，不是「图包里没有」。
     *   第一版只查 graph.json，于是把 title/desc/fate/note 全报成缺失 ——
     *   而那四个字段是**故意**放文案包的：`attachText()`（app.js）会
     *   `Object.assign(c, text.characters[c.id])` 把它们合并回来并 `refreshPanel()`。
     *   那是为体积做的渐进加载设计，不是缺陷。
     *   ⚠ 差点把设计当成缺陷报上去 —— 判断"缺失"之前必须先确认加载路径。 */
    const reachable = (f) => graphFields.has(f) || textFields.has(f);
    const lost = [...srcFields].filter((f) => !reachable(f));
    const realLost = lost.filter((f) => {
      if (f in GRAPH_OMITTED) return false;
      return src.characters.some((c) => {
        const v = c[f];
        if (v === undefined || v === null) return false;
        if (Array.isArray(v)) return v.length > 0;
        if (typeof v === 'string') return v.trim() !== '';
        return true;
      });
    });

    if (realLost.length) {
      problems.push(`${b.slug}：${realLost.length} 个**有值**的人物字段在图包和文案包里都找不到 —— `
        + realLost.join('、') + '。\n     它们在 data/' + b.slug + '.json 里有内容，但网页端只加载 '
        + b.slug + '.graph.json 与 .text.json，\n     而**这两个包里都没有** ⇒ 依赖它的功能在浏览器里是死的'
        + '（js/app.js 读到的永远是 undefined）。\n     修法：make-slim-packs.mjs 的字段白名单里补 put(o, 字段名, c.字段名)，'
        + '然后重跑 node scripts/make-slim-packs.mjs。\n     若确实**故意不带**（例如前端根本不读它），'
        + '写进这份脚本的 GRAPH_OMITTED 并说明理由。');
    }

    /* 反向也查一下：包里出现了源数据没有的字段 —— 那通常意味着白名单里打错了名字，
     * 于是该字段一直是 undefined，界面上什么都不显示，而且**没有任何报错**。 */
    const extra = [...graphFields, ...textFields].filter((f) => !srcFields.has(f));
    if (extra.length) {
      problems.push(`${b.slug}：图包/文案包里有源数据没有的字段 ${[...new Set(extra)].join('、')}`
        + '（多半是白名单里打错名字，于是该字段一直是 undefined）');
    }
  }
  return problems;
}

/* 入口判断：用 pathToFileURL 规范化再比。
 * ⚠ 第一版写的是 `import.meta.url.endsWith(process.argv[1].replace(/\\/g,'/'))`
 *   —— import.meta.url 带 `file:///` 前缀，而且路径里的空格是 **%20 编码**的
 *   （这个仓库目录名就带空格：「Claude Code+DeepSeekV4」）
 *   ⇒ 两边永远不相等，主流程**一次都没跑**，而退出码是 0
 *   —— 也就是"检查通过"其实是"检查没执行"。这类静默失效最难发现。 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ps = checkGraphFieldCoverage();
  if (!ps.length) { console.log('✓ graph.json 的人物字段覆盖：源数据里有值的字段，图包里都在'); process.exit(0); }
  for (const p of ps) console.error('✗ ' + p);
  process.exit(1);
}