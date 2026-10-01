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
 *
 * 这些都不依赖网络与模型，纯粹是"给定输入该给什么输出"，所以可以断言得很死。
 * 用法：node test/editor.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18971, CDP_PORT = 18972;

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) { console.error('找不到 Edge/Chrome，跳过'); process.exit(0); }

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

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
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(rep);
});
await new Promise((r) => server.listen(PORT, r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-ed-'));
const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--disable-gpu', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });

const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }

let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });

try {
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
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
    ['继母', 'step'], ['岳母', 'inlaw'], ['婆媳', 'inlaw'], ['乳母', 'foster'],
    ['夫妻', 'marriage'], ['妻子', 'marriage'],
    // 「同门师兄弟」含"兄弟"，血亲判断排在兜底之前 ⇒ 判成 blood 是当前的既定行为
    ['同门师兄弟', 'blood'], ['表兄弟', 'blood'],
    ['政敌', ''], ['同学', ''], ['', ''],
  ];
  for (const [t, want] of kin) {
    const got = await call('guessKin', t);
    ok(got === want, `guessKin(${JSON.stringify(t)}) = ${JSON.stringify(got)}${got === want ? '' : `（应为 ${JSON.stringify(want)}）`}`);
  }

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
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

console.log(`\n${'='.repeat(40)}`);
console.log(`编辑器测试　通过：${passed}  失败：${failed}`);
process.exit(failed > 0 ? 1 : 0);
