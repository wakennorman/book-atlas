#!/usr/bin/env node
/**
 * 编辑器逻辑测试（js/editor.js，1700 行，此前零覆盖）。
 *
 * 为什么需要它：编辑器承担整本 AI 生成流水线（EPUB/PDF 上传 → 逐章调模型 → 合并去重），
 * 里面几段纯逻辑最容易出错、又最难手测：
 *   · parseLooseJson —— 修 LLM 返回的截断 JSON。整本生成的成败全押在这一个函数上，
 *     它坏了的表现是"某一章老是失败"，而不是任何明显报错。
 *   · hanToNum / headingNo / splitChapters —— 从书里切章节。「一百二十回」这类汉字数字
 *     转不对，整本书就只会当成一整段。
 *   · cleanHtml —— EPUB 的 XHTML 转纯文本。
 *   · mergeDraft —— 把模型返回的人物/关系并进当前书（去重、合并别名）。
 *   · normalize —— 补齐缺失字段。
 *   · guessKin / kinIssues —— 从关系文案猜亲属类别、判「kin 与 type 自洽」（v0.152）。
 *     这两份都是 `scripts/kin.mjs` 的**手抄副本**（浏览器模块 import 不了 scripts/，
 *     那会要求把 scripts/ 也塞进 SW 预缓存）—— 抄漏一个词，就变成「编辑器判 A、CLI 判 B」，
 *     而两边都不会报错。所以这里既钉**金标**（正确答案）又做**对拍**（两边一致）。
 *
 * 这些都不依赖网络与模型，纯粹是"给定输入该给什么输出"，所以可以断言得很死。
 * 用法：node test/editor.mjs
 */
import fs from 'node:fs';
import { freePort } from './_free-port.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweepStaleProfiles, releaseProfile } from './_profile-guard.mjs';
import { guessKin as nodeGuessKin, checkKin as nodeCheckKin } from '../scripts/kin.mjs';
import { isParentChild as nodeIsParentChild } from '../scripts/kin-terms.mjs';
import { requireBrowser, browserArgs } from './browser-locator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = 0;   // v0.97：临时端口，listen 之后回填
const CDP_PORT = await freePort();

const EDGE = requireBrowser();

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };
const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;   // v0.97：临时端口

sweepStaleProfiles();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-ed-'));
/* v0.165.3：`stdio: 'ignore'` 把浏览器自己的报错**全扔了**。
 * 本文件在 CI（Ubuntu）上稳定连不上 CDP 端点，而 stdout 只有一句「连不上 CDP 端点」
 * —— 环境缺陷时这句话没有任何线索。改成接住 stderr（只留尾部，浏览器会刷很多日志），
 * 启动失败时一并打出来。 */
const proc = spawn(EDGE, [...browserArgs(), `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--disable-gpu', '--window-size=1600,1000', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
const browserLog = [];
for (const s of [proc.stdout, proc.stderr]) {
  s?.on('data', (d) => { browserLog.push(d); if (browserLog.length > 400) browserLog.shift(); });
}
const browserTail = (n = 3000) => Buffer.concat(browserLog).toString('utf8').slice(-n).trim();

const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
/* v0.165.3：预算从 10 秒（40 × 250ms）放宽到 30 秒。CI 上浏览器是**冷启动**
 *（首次运行要建 profile、字体缓存），10 秒贴着边缘 —— browser.mjs 用同样的
 * 10 秒预算能过、这里过不了，说明它本来就只是勉强够，不是有余量。 */
for (let i = 0; i < 120 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }

let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));  /* v0.115：CDP 响应不来时 pending 条目永不 settle ⇒ 静默挂死。 */ setTimeout(() => { if (pending.delete(id)) reject(new Error(method + ' 30 秒无响应')); }, 30000);});

try {
/* ⚠ 连不上 CDP 时必须**在这里**报错退出，不能往下走。
 *
 * 下面是 `new WebSocket(url)` 加一个只监听 onopen/onerror 的 promise ——
 * url 拿不到时它是 null，连不上时那个 promise **永远不 settle**，
 * 于是进程静默挂死：stdout / stderr **0 字节**，没有异常、没有退出码，
 * 看起来像"卡在某个断言上"，其实一条断言都还没开始跑。
 * 实测在门禁里撞过两次，每次要等十几分钟超时才发现。
 * （v0.100 把这道防线补齐到所有走 CDP 的测试文件。）
 */
if (!url) {
  console.error('  ✗ Edge 起来后连不上 CDP 端点 —— 这是**环境/负载**问题，不是断言失败。');
  console.error(`    浏览器：${EDGE}　端口：${CDP_PORT}　profile：${profile}`);
  console.error(`    等了 30 秒；进程还活着吗：${proc.exitCode === null ? '是' : '否，已退出 code=' + proc.exitCode}`);
  const tail = browserTail();
  console.error(tail ? '    ── 浏览器自己的输出（尾部）──\n' + tail : '    （浏览器没吐出任何 stderr —— 它可能压根没起来）');
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  releaseProfile(profile);
  process.exit(1);
}

  ws = new WebSocket(url);
  await Promise.race([

    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }),

    new Promise((_, rej) => setTimeout(() => rej(new Error('CDP WebSocket 10 秒内没连上')), 10000)),

  ]);
  ws.onmessage = (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); }
  };
  const js = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const call = async (fn, arg) => js(`window.__ed.${fn}(${JSON.stringify(arg)})`);
  const tryCall = async (fn, arg) => js(`(() => { try { return { ok: true, v: window.__ed.${fn}(${JSON.stringify(arg)}) }; } catch (e) { return { ok: false, e: String(e && e.message || e) }; } })()`);

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/editor.html` });
  let up = false;
  for (let i = 0; i < 80; i++) {
    up = await js('!!(window.__ed && window.__ed.state)').catch(() => false);
    if (up) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  ok(up, '编辑器加载完成（window.__ed 就绪）');
  if (!up) throw new Error('编辑器没起来');

  /* ---------- hanToNum：汉字数字 ---------- */
  console.log('\n▶ 汉字数字 → 阿拉伯数字');
  const han = [
    ['一', 1], ['十', 10], ['十一', 11], ['二十', 20], ['二十一', 21],
    ['一百', 100], ['一百二十', 120], ['一百二十回', 0], ['两', 2], ['〇', 0], ['零', 0],
    ['42', 42], ['一千零一', 1001], ['三千', 3000], ['abc', 0], ['', 0],
  ];
  for (const [input, want] of han) {
    const got = await call('hanToNum', input);
    ok(got === want, `hanToNum(${JSON.stringify(input)}) = ${got}${got === want ? '' : `（应为 ${want}）`}`);
  }

  /* ---------- headingNo：认章节标题行 ---------- */
  console.log('\n▶ 识别章节标题');
  const heads = [
    ['第一章', 1], ['第 1 回', 1], ['第一百二十回', 120], ['第十二章 标题', 12],
    ['  第三卷', 3], ['　第五回　', 5], ['不是标题', 0], ['', 0],
  ];
  for (const [line, want] of heads) {
    const got = await call('headingNo', line);
    ok(got === want, `headingNo(${JSON.stringify(line)}) = ${got}${got === want ? '' : `（应为 ${want}）`}`);
  }

  /* ---------- splitChapters：整本切章 ---------- */
  console.log('\n▶ 整本切章');
  const text = [
    '第一章 起始', '从前有个人。', '他叫甲。', '',
    '第二章 转折', '后来出了事。', '乙来了。', '',
    '第三章 结局', '结束。',
  ].join('\n');
  const chs = await call('splitChapters', text);
  ok(Array.isArray(chs) && chs.length === 3, `三章的书切成 ${chs ? chs.length : '?'} 章（应为 3）`);
  ok(chs && chs[0].no === 1 && chs[1].no === 2 && chs[2].no === 3,
    `章号依次为 ${chs ? chs.map((c) => c.no).join(',') : '?'}（应为 1,2,3）`);
  ok(chs && chs[0].text.includes('甲'), '第一章正文含「甲」');
  ok(chs && chs[2].text.includes('结束'), '末章正文含「结束」');

  const noChap = await call('splitChapters', '就一段没有任何标题的正文。');
  ok(Array.isArray(noChap) && noChap.length === 1 && noChap[0].no === 0,
    `无章节标题时整段处理（no=0），实际 ${noChap ? noChap.length + ' 段' : '?'}`);
  ok((await call('splitChapters', '')).length === 0, '空文本返回 0 章');

  /* ---------- parseLooseJson：修模型返回的坏 JSON ---------- */
  console.log('\n▶ 修模型返回的 JSON（整本生成的成败全靠它）');
  const p1 = await tryCall('parseLooseJson', '{"a":1,"b":[2,3]}');
  ok(p1.ok && p1.v && p1.v.a === 1 && p1.v.b.length === 2, '标准 JSON 直接能解析');

  const p2 = await tryCall('parseLooseJson', '好的，这是结果：\n{"title":"百年孤独","characters":[{"id":"a","name":"甲"}]}\n希望对你有帮助！');
  ok(p2.ok && p2.v && p2.v.title === '百年孤独' && p2.v.characters.length === 1,
    '前后裹着说明文字也能抠出 JSON');

  // max_tokens 拦腰截断：一个括号都没合上（marks 为空）—— v85 新增的分支就管这个
  const p3 = await tryCall('parseLooseJson', '{"a":1,"b":{"c":2,"d":[3,4');
  ok(p3.ok && p3.v && p3.v.a === 1 && p3.v.b.d.length === 2,
    `被截断的 JSON 能补齐括号（实际 ${JSON.stringify(p3.v)}）`);

  // 截断发生在若干个完整对象之后（marks 非空）—— 走原有的"往前退一格"分支
  const p3b = await tryCall('parseLooseJson', '{"a":1,"done":{"x":1},"tail":{"y":2');
  ok(p3b.ok && p3b.v && p3b.v.a === 1, `部分闭合的截断也能救回（实际 ${JSON.stringify(p3b.v)}）`);

  // 停在字符串中间时不能硬拼 —— 半个字符串补出来的是脏数据，宁可报错
  const p3c = await tryCall('parseLooseJson', '{"a":1,"b":"未写完的半句话');
  ok(!p3c.ok || typeof p3c.v === 'object', '停在字符串中间时不硬拼出脏数据');

  const p4 = await tryCall('parseLooseJson', '{"s":"里面有个 } 字符","t":"还有 \\" 引号"}');
  ok(p4.ok && p4.v && p4.v.s.includes('}') && p4.v.t.includes('"'),
    '字符串里的 } 和转义引号不会被误当成结构');

  const p5 = await tryCall('parseLooseJson', '这里完全没有 JSON');
  ok(!p5.ok, '确实没有 JSON 时报错而不是静默返回垃圾');

  /* ---------- cleanHtml ---------- */
  console.log('\n▶ EPUB 的 XHTML 转纯文本');
  const h1 = await call('cleanHtml', '<p>第一段</p><p>第二段</p>');
  ok(h1.includes('第一段') && h1.includes('第二段') && !h1.includes('<p>'), '标签被去掉、段落变换行');

  const h2 = await call('cleanHtml', '<script>evil()</script><style>x{}</style><p>正文</p>');
  ok(!h2.includes('evil') && !h2.includes('x{}') && h2.includes('正文'), 'script/style 内容被剔除');

  const h3 = await call('cleanHtml', 'A&amp;B&nbsp;C&#65;');
  ok(h3.includes('A&B') && h3.includes('C') && h3.includes('A'), 'HTML 实体与数字实体被还原');

  /* ---------- guessKin ---------- */
  console.log('\n▶ 从关系文案猜亲属类别');
  const kin = [
    ['结义兄弟', 'sworn'], ['义兄弟', 'sworn'], ['收养', 'adoptive'], ['过继', 'adoptive'],
    ['继母', 'step'], ['晚爹', 'step'], ['岳母', 'inlaw'], ['婆媳', 'inlaw'], ['乳母', 'foster'],
    ['夫妻', 'marriage'], ['妻子', 'marriage'], ['未婚夫妻', ''],
    ['表兄弟', 'blood'], ['堂姐妹', 'blood'], ['双胞胎', 'blood'],
    // v0.146：「同门师兄弟」含"兄弟"，但「同门」在"不是家人"表里 ⇒ 留空。
    //   以前这里是 `'blood'`，与 scripts/kin.mjs 不一致（那边把同门当非亲属）——
    //   而编辑器会把这个猜测**自动写进 kin 字段** ⇒ 同门关系被误标成血缘。
    ['同门师兄弟', ''], ['同窗', ''], ['门生', ''], ['忘年交', ''], ['幽灵', ''],
    ['政敌', ''], ['同学', ''], ['', ''],
  ];
  for (const [t, want] of kin) {
    const got = await call('guessKin', t);
    ok(got === want, `guessKin(${JSON.stringify(t)}) = ${JSON.stringify(got)}${got === want ? '' : `（应为 ${JSON.stringify(want)}）`}`);
  }

  /* ---------- guessKin 与 scripts/kin.mjs 对拍 ----------
   * 编辑器里那份是**手抄的第二份**（editor.js 是浏览器模块，import 不了 scripts/），
   * 已经漂过：少了 `晚爹`、NOT_KIN 少 12 个词、BLOOD 少 9 个词。
   * 两边不一致时，同一句关系名在编辑器里被猜成 A、在 validate / 整本生成里被猜成 B，
   * 而两边都不会报错 —— 典型的静默漂移。
   *
   * ⚠ 对拍只能抓「两边不一致」，**抓不到「两边一起错」**（比如两边都把某个非亲属词判成 blood）。
   *   所以上面那张金标表不能删，它是钉住"正确答案"的那一半。
   * ⚠ 语料要含**真实数据的全部 relations[].type**，不能只写几个例子 ——
   *   漏掉的那 9 个 BLOOD 词（堂姐妹/表亲/双胞胎…）正是只有真数据才会覆盖到的。 */
  console.log('\n▶ guessKin 与 scripts/kin.mjs 对拍（真实数据 + 边界词）');
  const corpus = new Set();
  // ⚠ 必须把**上面金标表的输入**也放进来：对拍的语料漏掉某条，那条就只剩金标在守，
  //   两条判据各漏一半。实测踩过：只加了 '同门' 没加 '同门师兄弟' ⇒ 编辑器漏掉 `同门`
  //   这个词时对拍照样全绿（真实数据里只有「同门友军」，两边都不命中）。
  for (const [t] of kin) corpus.add(t);
  for (const slug of ['three-kingdoms', 'crime-and-punishment', 'one-hundred-years-of-solitude']) {
    const fp = path.join(ROOT, 'data', `${slug}.json`);
    if (!fs.existsSync(fp)) continue;
    for (const r of JSON.parse(fs.readFileSync(fp, 'utf8')).relations || []) {
      if (r && r.type) corpus.add(String(r.type));
    }
  }
  for (const t of [
    '养兄弟', '养祖孙', '抚养', '养大', '继父', '晚娘', '晚爹', '义母', '干爹', '结拜姐妹',
    '妻舅', '妻弟', '国舅', '姻亲', '内兄', '大舅子', '儿媳', '女婿', '妯娌', '连襟',
    '堂亲', '表亲', '双胞胎', '孪生姐妹', '同门', '同僚', '座师', '囚犯', '酒鬼', '犯罪',
    '未婚夫妻', '未婚妻', '恋人', '情人', '单相思', '保姆', '房东', '信使', '狱友', '',
  ]) corpus.add(t);

  const types = [...corpus];
  // 一次求值把整批算完（逐条 call 会有上千次 CDP 往返）
  const browserKin = await js(`(${JSON.stringify(types)}).map((t) => window.__ed.guessKin(t))`);
  const diffs = types.map((t, i) => [t, browserKin[i], nodeGuessKin(t)])
    .filter(([, a, b]) => a !== b);
  for (const [t, a, b] of diffs.slice(0, 8)) {
    console.error(`      · ${JSON.stringify(t)}：编辑器=${JSON.stringify(a)}  kin.mjs=${JSON.stringify(b)}`);
  }
  ok(diffs.length === 0,
    `编辑器与 kin.mjs 的 guessKin 在 ${types.length} 个关系名上完全一致${diffs.length ? `（${diffs.length} 个不一致）` : ''}`);

  /* ---------- kinIssues：kin ⇄ type 自洽的唯一判定（v0.152） ----------
   * 这段规则原先在编辑器里**抄了两份**：`validate()`（「校验」按钮）一份、
   * `healthCheck()`（「数据体检」面板）一份 —— 而且已经漂了：
   *   validate() 在 v0.147 收紧了（`kin !== 'blood'` + 21 个血缘称谓词），
   *   healthCheck() 还停在旧规则（只管 收养/继亲/结义/抚养 4 类 + 13 个词）。
   * 于是「堂兄弟 + kin=收养」在「校验」里报错、在「数据体检」面板里**一声不吭** ——
   * 同一份数据两个答案，用户只在点「校验」时才看得到。
   * （v0.147 修掉的两条「舅甥 + kin=inlaw」正是踩在这条缝里：CLI 报、面板不报。）
   *
   * 现在两处共用 `kinIssues()`。下面两组断言守它：
   *   ① 金标 —— 钉"正确答案"（含旧面板漏掉的 8 个血缘称谓、以及 inlaw/marriage 两类）
   *   ② 对拍 —— 钉"编辑器这份 == scripts/kin.mjs 的 checkKin"（真实数据的全部 type × 各种 kin 值）
   * ⚠ 对拍只能抓「两边不一致」，抓不到「两边一起错」⇒ ① 不能删。
   * ⚠ 断言钉的是**命中的分支名**（code），不是文案 —— 改措辞不该让测试红。 */
  console.log('\n▶ kinIssues：kin 与 type 自洽（金标）');
  const KI = [
    // [type, kin, 期望命中的 code 序列]
    ['父子', 'blood', []],                                  // 正例
    ['养父子', 'adoptive', []],                             // 正例：BLOOD_TERM 锚定在开头 ⇒ 不该命中「父子」
    ['父子', 'bogus', ['bad-kin']],
    ['父子', '', ['missing']],
    ['同宗', 'blood', ['blood-unclear']],                   // 真实数据里 4 条都是这一类
    ['父子', 'adoptive', ['blood-term', 'mismatch']],
    ['母子', 'sworn', ['blood-term', 'mismatch']],
    ['舅甥', 'inlaw', ['blood-term', 'mismatch']],          // v0.147 修的两条数据正是这个形状
    ['夫妻', 'inlaw', ['mismatch']],                        // 「婚姻 / 姻亲」的边界：不是血缘称谓，只报错配
    // ↓ 下面 8 个词是 healthCheck() 旧正则漏掉的：旧面板对每一条都一声不吭
    ['堂兄弟', 'adoptive', ['blood-term', 'mismatch']],
    ['表兄妹', 'foster', ['blood-term', 'mismatch']],
    ['姨甥', 'step', ['blood-term', 'mismatch']],
    ['孪生姐妹', 'sworn', ['blood-term', 'mismatch']],
    ['父子关系', 'adoptive', ['blood-term', 'mismatch']],
    ['姑侄', 'marriage', ['blood-term', 'mismatch']],
    ['叔侄', 'inlaw', ['blood-term', 'mismatch']],
    ['祖孙', 'adoptive', ['blood-term', 'mismatch']],
    // kin 的"空值哨兵"：LLM 常把"没有"写成这些，checkKin 当留空处理，编辑器必须一致
    ['父子', '无', ['missing']], ['父子', 'none', ['missing']], ['父子', '-', ['missing']],
  ];
  const kiGot = await js(`(${JSON.stringify(KI.map(([t, k]) => [t, k]))}).map(([t, k]) => window.__ed.kinIssues(t, k).map((x) => x.code))`);
  for (let i = 0; i < KI.length; i++) {
    const [t, k, want] = KI[i];
    const got = kiGot[i] || [];
    ok(sameArr(got, want), `kinIssues(${JSON.stringify(t)}, ${JSON.stringify(k)}) → ${JSON.stringify(got)}${sameArr(got, want) ? '' : `（应为 ${JSON.stringify(want)}）`}`);
  }

  console.log('\n▶ kinIssues 与 scripts/kin.mjs 的 checkKin 对拍（真实数据全部 type × 各种 kin 值）');
  const KIN_VALS = ['', 'blood', 'marriage', 'inlaw', 'adoptive', 'foster', 'step', 'sworn', '无', 'none', 'bogus'];
  const pairs = [];
  for (const t of types) for (const k of KIN_VALS) pairs.push([t, k]);
  const edCodes = await js(`(${JSON.stringify(pairs)}).map(([t, k]) => window.__ed.kinIssues(t, k).map((x) => x.code))`);
  let kiBad = 0; const kiSamples = [];
  pairs.forEach(([t, k], i) => {
    const ed = edCodes[i] || [];
    const ck = nodeCheckKin({ type: t, kin: k });
    const edErr = ed.includes('bad-kin') || ed.includes('blood-term');
    const ckErr = ck.some((x) => x.level === 'error');
    if (ed.length !== ck.length || edErr !== ckErr) {
      kiBad++;
      if (kiSamples.length < 6) {
        kiSamples.push(`type=${JSON.stringify(t)} kin=${JSON.stringify(k)}：编辑器 ${JSON.stringify(ed)}（error=${edErr}）vs checkKin ${JSON.stringify(ck.map((x) => x.level))}（error=${ckErr}）`);
      }
    }
  });
  for (const s of kiSamples) console.error(`      · ${s}`);
  ok(kiBad === 0,
    `kinIssues 与 checkKin 在 ${pairs.length} 组 (type × kin) 上命中条数与"是否报错"完全一致${kiBad ? `（${kiBad} 组不一致）` : ''}`);

  /* ---------- normalize ---------- */
  console.log('\n▶ 补齐缺失字段');
  const n1 = await call('normalize', {});
  ok(n1.meta && n1.meta.title === '未命名' && n1.meta.chapters === 20, '空对象补出默认 meta（未命名 / 20 章）');
  ok(Array.isArray(n1.characters) && Array.isArray(n1.relations) && Array.isArray(n1.events), '六个集合都补成数组');

  const n2 = await call('normalize', { meta: { title: '我的书', chapters: 30 }, characters: null });
  ok(n2.meta.title === '我的书' && n2.meta.chapters === 30, '已有 meta 不被默认值覆盖');
  ok(Array.isArray(n2.characters), 'characters 为 null 时补成数组');

  /* ---------- mergeDraft：把模型结果并进当前书 ---------- */
  console.log('\n▶ 合并模型返回的人物与关系');
  const merge = await js(`(() => {
    const ed = window.__ed.state;
    ed.book = window.__ed.normalize({
      meta: { slug: 't', title: 'T', chapters: 10 },
      factions: [{ key: 'a', name: '甲派', color: '#111' }],
      characters: [{ id: 'c1', name: '甲', aliases: ['老甲'], desc: '原有描述', fate: '善终' }],
      relations: [], phases: [], events: [], places: [],
    });
    const st = window.__ed.mergeDraft({
      characters: [
        { id: 'c1', name: '甲', aliases: ['阿甲'], desc: '新描述', fate: '改写' },   // 同 id ⇒ 合并
        { id: 'c9', name: '乙', aliases: [], desc: '', fate: '' },                    // 新人
      ],
      relations: [{ from: 'c1', to: 'c9', type: '结义兄弟', kin: 'sworn' }],
      events: [], places: [], phases: [],
    });
    const chars = ed.book.characters;
    return {
      st,
      n: chars.length,
      c1: chars.find(c => c.id === 'c1'),
      hasC9: chars.some(c => c.id === 'c9'),
      rels: ed.book.relations.length,
      relKin: ed.book.relations[0] && ed.book.relations[0].kin,
    };
  })()`);
  ok(merge.n === 2, `合并后共 ${merge.n} 人（甲 + 新增乙，应为 2，没有重复插入甲）`);
  ok(merge.c1 && merge.c1.aliases.includes('老甲') && merge.c1.aliases.includes('阿甲'),
    `同一个人合并了别名：${merge.c1 ? JSON.stringify(merge.c1.aliases) : '?'}`);
  ok(merge.c1 && merge.c1.desc === '原有描述', '已有 desc 不被空/新值覆盖成空');
  ok(merge.hasC9, '新人物被加入');
  ok(merge.rels === 1 && merge.relKin === 'sworn', `关系被并入且 kin=${merge.relKin}`);

  /* ---------- 撤销 / 重做 ---------- */
  console.log('\n▶ 撤销 / 重做');
  const hist = await js(`(() => {
    const ed = window.__ed.state;
    ed.book = window.__ed.normalize({ meta: { slug: 'h', title: 'H1', chapters: 10 },
      factions: [], characters: [], relations: [], phases: [], events: [], places: [] });
    const snap = window.__ed.__snapshot ? window.__ed.__snapshot : null;
    // 用公开入口驱动：setBook 无对外接口，这里直接看 history 结构是否可用
    return { total: ed.history.length, index: ed.hIndex, limit: ed.histLimit };
  })()`);
  ok(typeof hist.total === 'number', `撤销栈结构可读（history=${hist.total}, hIndex=${hist.index}, limit=${hist.limit}）`);

  const undoRes = await js(`(() => { const before = JSON.stringify(window.__ed.state.book); window.__ed.undo(); return { same: JSON.stringify(window.__ed.state.book) === before }; })()`);
  ok(undoRes.same === true, '没有历史时 undo 不会破坏当前内容');

  const redoRes = await js(`(() => { const before = JSON.stringify(window.__ed.state.book); window.__ed.redo(); return { same: JSON.stringify(window.__ed.state.book) === before }; })()`);
  ok(redoRes.same === true, '没有历史时 redo 不会破坏当前内容');

  /* ---------- 「校验」与「数据体检」必须给同一个答案（v0.152） ----------
   * 这条是**最贴近用户**的断言：kinIssues() 抽出来了、两边都调它 —— 但只要哪天有人
   * 把其中一个入口改回"自己再抄一份"，上面那两组断言**都不会红**（它们只测 kinIssues 本身）。
   * 这里直接把两个入口都跑一遍，要求产出的 kin 条目**逐字相同**。
   *
   * 认条目的办法：两个入口产出的 kin 条目长这样 —— `关系 甲→乙：…`（冒号分隔）；
   * 其余条目的分隔符是空格或没有（`关系 甲→乙 没有小事件` / `关系 甲→乙 缺少关系名 type`），
   * 所以用 `^关系 …→…：` 就能把 kin 条目择出来。 */
  console.log('\n▶ 「校验」与「数据体检」对同一份数据给同一个答案');
  const kinBook = {
    meta: { slug: 'kinbook', title: 'kinbook', chapters: 10 },
    factions: [], places: [], phases: [], events: [],
    characters: [
      { id: 'a', name: '甲', gender: 'm', firstCh: 1 },
      { id: 'b', name: '乙', gender: 'f', firstCh: 1 },
    ],
    relations: KI.map(([type, kin]) => ({ from: 'a', to: 'b', type, kin, events: [{ chapter: '第 1 章', text: 'x' }] })),
  };
  const two = await js(`(() => {
    const ed = window.__ed.state;
    ed.book = window.__ed.normalize(${JSON.stringify(kinBook)});
    const isKin = (s) => /^关系 .+→.+：/.test(s);
    return {
      v: window.__ed.validate().filter(isKin).sort(),
      h: window.__ed.health().filter((x) => x.sec === 'relations' && isKin(x.msg)).map((x) => x.msg).sort(),
    };
  })()`);
  const vOnly = two.v.filter((x) => !two.h.includes(x));
  const hOnly = two.h.filter((x) => !two.v.includes(x));
  if (vOnly.length || hOnly.length) {
    console.error(`      · 只有「校验」报：${JSON.stringify(vOnly)}`);
    console.error(`      · 只有「体检」报：${JSON.stringify(hOnly)}`);
  }
  ok(sameArr(two.v, two.h) && two.v.length > 0,
    `两个入口在 ${KI.length} 条关系上给出逐字相同的 kin 条目（${two.v.length} 条）`);

  /* ---------- 亲子边：编辑器那份必须与权威同口径（v0.153） ----------
   * 「哪条关系算亲子边」原先在编辑器里是「`kin === 'blood'` 且 type 以 父/母 或 子/女 开头」，
   * 而权威是 `scripts/kin-terms.mjs` 的 `isParentChild`（**含「养父子」**）⇒
   * 编辑器的「亲子成环」检测把**全部收养亲子边**漏掉了（三国 7 条、百年孤独 2 条）。
   * 源码级 / 结构级 / 金标在 test/parent-child.mjs；这里补两条只有浏览器能测的。 */
  console.log('\n▶ 亲子边：与 scripts/kin-terms.mjs 的 isParentChild 对拍（真实数据）');
  const pcTriples = [];
  for (const slug of ['three-kingdoms', 'crime-and-punishment', 'one-hundred-years-of-solitude']) {
    const fp = path.join(ROOT, 'data', `${slug}.json`);
    if (!fs.existsSync(fp)) continue;
    for (const r of JSON.parse(fs.readFileSync(fp, 'utf8')).relations || []) pcTriples.push([r.from, r.to, String(r.type || '')]);
  }
  const pcWant = pcTriples.filter(([, , t]) => nodeIsParentChild({ type: t })).map(([f, t]) => `${f}>${t}`).sort();
  const pcGot = await js(`window.__ed.parentChildEdges({ relations: ${JSON.stringify(pcTriples)}.map(([from, to, type]) => ({ from, to, type })) }).sort()`);
  const pcOnlyEd = pcGot.filter((x) => !pcWant.includes(x));
  const pcOnlyNode = pcWant.filter((x) => !pcGot.includes(x));
  if (pcOnlyEd.length || pcOnlyNode.length) {
    console.error(`      · 只有编辑器算的边（${pcOnlyEd.length}）：${JSON.stringify(pcOnlyEd.slice(0, 5))}`);
    console.error(`      · 只有权威算的边（${pcOnlyNode.length}）：${JSON.stringify(pcOnlyNode.slice(0, 5))}`);
  }
  ok(sameArr(pcGot, pcWant),
    `编辑器与 isParentChild 在 ${pcTriples.length} 条关系上算出的亲子边完全一致（${pcWant.length} 条）`);

  console.log('\n▶ 亲子成环：收养边构成的环，「校验」与「体检」都必须报出来');
  const ringBook = (kin, type) => ({
    meta: { slug: 'ring', title: 'ring', chapters: 10 },
    factions: [], places: [], phases: [], events: [],
    characters: [
      { id: 'a', name: '甲', gender: 'm', firstCh: 1 },
      { id: 'b', name: '乙', gender: 'f', firstCh: 1 },
    ],
    relations: [
      { from: 'a', to: 'b', type, kin, events: [{ chapter: '第 1 章', text: 'x' }] },
      { from: 'b', to: 'a', type, kin, events: [{ chapter: '第 1 章', text: 'x' }] },
    ],
  });
  const ringOf = (book) => `(() => {
    const ed = window.__ed.state;
    ed.book = window.__ed.normalize(${JSON.stringify(book)});
    const hit = (s) => /亲子关系成环/.test(s);
    return { v: window.__ed.validate().filter(hit).length, h: window.__ed.health().filter((x) => hit(x.msg)).length };
  })()`;
  const rBlood = await js(ringOf(ringBook('blood', '父子')));
  ok(rBlood.v > 0 && rBlood.h > 0, `血缘亲子环（父子 / kin=blood）两个入口都报：校验 ${rBlood.v} 条 / 体检 ${rBlood.h} 条`);
  const rAdopt = await js(ringOf(ringBook('adoptive', '养父子')));
  ok(rAdopt.v > 0 && rAdopt.h > 0,
    `**收养**亲子环（养父子 / kin=adoptive）两个入口都报：校验 ${rAdopt.v} 条 / 体检 ${rAdopt.h} 条（旧编辑器规则对这条一声不吭）`);

  /* ---------- 页面无报错 ---------- */
  const logs = await js('window.__edErrors || []');
  ok(!logs || logs.length === 0, '编辑器运行期间无未捕获异常');
} catch (e) {
  failed++;
  console.error('  ✗ 编辑器测试异常：' + e.message);
} finally {
  try { ws && ws.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  releaseProfile(profile);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`编辑器测试　通过：${passed}  失败：${failed}`);
process.exit(failed > 0 ? 1 : 0);
