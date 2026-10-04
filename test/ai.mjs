// v93：AI 讲解的「继续追问」
//  真调 API 不可能也不该，所以这里替换 window.fetch，直接检查**发出去的 messages**：
//  · 第一次只有 system + user；
//  · 追问后变成 system + user + assistant + user，且 **system 每轮都在**（不剧透硬约束不能省）；
//  · 请求失败要把这条提问撤掉（否则下一轮会被当成"用户连问两次"）；
//  · 点「讲一遍」重开一段新对话。
// 顺带核对默认模型名已从 deepseek-chat 换成 deepseek-flash（前者已进入弃用流程）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon' };
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
server.on('error', (e) => { console.error('静态服务器起不来：' + e.message); process.exit(1); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p));
if (!EDGE) { console.log('  (跳过) 找不到 Edge/Chrome'); process.exit(0); }
const CDP_PORT = 19480;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-ai-'));
const proc = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const cdpUrl = () => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; });
    r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page').webSocketDebuggerUrl); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let url = null;
for (let i = 0; i < 40 && !url; i++) { try { url = await cdpUrl(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
const ws = new WebSocket(url);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); } };
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, 40000);
});
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

/** 在页面里装一个假 fetch：记录每次请求的 messages，按脚本返回 canned 回复 */
const installFetch = (replies) => js(`(() => {
  window.__calls = [];
  window.__replies = ${JSON.stringify(replies)};
  const real = window.fetch;
  window.fetch = function (url, opts) {
    if (!/\\/chat\\/completions/.test(String(url))) return real.apply(this, arguments);
    let body = {};
    try { body = JSON.parse(opts.body); } catch (e) { /* 忽略 */ }
    const i = window.__calls.length;
    window.__calls.push({ url: String(url), body });
    const reply = window.__replies[i];
    return Promise.resolve(reply === null
      ? Promise.reject(new Error('Failed to fetch'))
      : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content: reply } }] }), text: () => Promise.resolve('') }));
  };
  return true;
})()`);

const calls = () => js(`window.__calls.map((c) => ({ url: c.url, model: c.body.model, roles: c.body.messages.map((m) => m.role), texts: c.body.messages.map((m) => m.content) }))`);
const panelState = () => js(`(() => {
  const b = document.getElementById('ai-answer');
  if (!b) return { none: true };
  return {
    hidden: b.hidden,
    hasForm: !!b.querySelector('[data-ai-ask]'),
    hasInput: !!b.querySelector('.ai-ask-input'),
    inputDisabled: b.querySelector('.ai-ask-input') ? b.querySelector('.ai-ask-input').disabled : null,
    placeholder: b.querySelector('.ai-ask-input') ? b.querySelector('.ai-ask-input').placeholder : '',
    ariaLabel: b.querySelector('.ai-ask-input') ? b.querySelector('.ai-ask-input').getAttribute('aria-label') : null,
    questions: [...b.querySelectorAll('.ai-q')].map((n) => n.textContent.trim()),
    answers: [...b.querySelectorAll('.ai-a')].map((n) => n.textContent.trim()),
    err: b.querySelector('.ai-err') ? b.querySelector('.ai-err').textContent.trim() : null,
    foot: b.querySelector('.ai-foot') ? b.querySelector('.ai-foot').textContent.trim().replace(/\\s+/g, ' ') : null,
  };
})()`);

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
  for (let i = 0; i < 300; i++) { if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length>500)`).catch(() => false)) break; await wait(100); }
  await wait(2500);
  await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`).catch(() => {});
  await wait(1500);

  console.log('▶ ① 默认模型名已不是被弃用的 deepseek-chat');
  // 设置框的 value 只在**打开设置时**才被填上（openAiModal 才写），所以先打开再读。
  // 第一版直接读 value 拿到空串，还以为功能坏了。
  await js(`window.__ba.selectCharacter('cao-cao')`).catch(() => {});
  await wait(800);
  await js(`(() => { const b = [...document.querySelectorAll('#panel [data-ai-settings]')][0]; if (b) b.click(); })()`);
  await wait(400);
  const cfg0 = await js(`(() => ({ input: (document.getElementById('ai-model')||{}).value, ph: (document.getElementById('ai-model')||{}).placeholder }))()`);
  await js(`document.getElementById('ai-modal').hidden = true`);
  console.log(`    设置框：value="${cfg0.input}" placeholder="${cfg0.ph}"`);
  ok(cfg0.input === 'deepseek-flash', `设置框里是 deepseek-flash（实际 "${cfg0.input}"）`);
  ok(cfg0.ph === 'deepseek-flash', '占位文字也换了');

  console.log('\n▶ ② 没配 Key 时不调模型，只弹设置框（原来就有，别被追问改坏）');
  await js(`localStorage.removeItem('ba-ai-key')`);
  await js(`window.__ba.selectCharacter('cao-cao')`);
  await wait(1200);
  await installFetch(['不该被调用']);
  await js(`(() => { const b = [...document.querySelectorAll('#panel [data-ai="char"]')][0]; if (b) b.click(); })()`);
  await wait(900);
  ok((await calls()).length === 0, '没有 Key ⇒ 一个请求都没发出去（不消耗额度）');
  ok(await js(`document.getElementById('ai-modal').hidden === false`), '弹出了 API Key 设置框');

  console.log('\n▶ ③ 配了 Key 才真的调模型');
  await js(`localStorage.setItem('ba-ai-key', 'sk-test-not-real')`);
  await js(`window.__ba.saveAiConfig ? window.__ba.saveAiConfig() : (localStorage.setItem('ba-ai-key','sk-test-not-real'))`);
  await js(`document.getElementById('ai-modal').hidden = true`);
  // 给**两条**回复：第一条给「讲一遍」，第二条给后面那次追问。
  // 第一版只给了一条，追问那次拿到 undefined → 走"模型没有返回内容"的回滚分支，
  // 问句被撤掉，断言全红 —— 看着像产品坏了，其实是我把回复列表配短了。
  await installFetch(['曹操是东汉末年的政治家、军事家。', '曹操与刘备早年同在洛阳一带活动。']);
  await js(`(() => { const b = [...document.querySelectorAll('#panel [data-ai="char"]')][0]; if (b) b.click(); })()`);
  await wait(1200);
  const c1 = await calls();
  ok(c1.length === 1, `发出了 1 次请求（实际 ${c1.length}）`);
  ok(/\/chat\/completions$/.test(c1[0].url), `打到 chat/completions（${c1[0].url}）`);
  ok(c1[0].model === 'deepseek-flash', `用的模型是 deepseek-flash（实际 ${c1[0].model}）`);
  ok(JSON.stringify(c1[0].roles) === JSON.stringify(['system', 'user']), `第一次只有 system + user（实际 ${JSON.stringify(c1[0].roles)}）`);
  ok(/不要使用你自己的记忆/.test(c1[0].texts[0]), 'system 里带「只用给定资料、不用自己的记忆」');
  ok(/不要提任何更后面的情节/.test(c1[0].texts[0]), 'system 里带「不提前面章节」的剧透硬约束');

  let p = await panelState();
  ok(!p.hidden, 'AI 区域显示出来了');
  ok(p.hasForm && p.hasInput, '有追问输入框');
  ok(p.ariaLabel === '继续追问', `输入框有无障碍名称（aria-label=${p.ariaLabel}）`);
  ok(/第 \d+ 章之前/.test(p.placeholder), `占位文字提醒剧透边界：「${p.placeholder}」`);
  ok(p.answers.length === 1 && /曹操是东汉末年/.test(p.answers[0]), `第一段回答渲染出来了（${JSON.stringify(p.answers)}）`);
  console.log(`    页脚：${p.foot}`);

  console.log('\n▶ ④ 追问：带完整历史，且 system 每轮都在');
  await js(`(() => { const i = document.querySelector('.ai-ask-input'); i.value = '他和刘备是怎么认识的？'; i.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); })()`);
  await wait(1200);
  const c2 = await calls();
  ok(c2.length === 2, `追问发出了第 2 次请求（实际 ${c2.length}）`);
  ok(JSON.stringify(c2[1].roles) === JSON.stringify(['system', 'user', 'assistant', 'user']),
    `历史完整带上了：${JSON.stringify(c2[1].roles)}`);
  ok(c2[1].texts[0] === c1[0].texts[0], 'system 提示词与第一次**逐字相同**（剧透约束没被"有历史了"省略掉）');
  ok(c2[1].texts[3] === '他和刘备是怎么认识的？', '最后一轮是用户这句追问');
  ok(/曹操是东汉末年/.test(c2[1].texts[2]), '上一轮的回答也带上了（模型知道前面在讲什么）');
  p = await panelState();
  ok(p.questions.length === 1 && /刘备/.test(p.questions[0]), `问句渲染出来了（${JSON.stringify(p.questions).slice(0, 60)}）`);
  ok(p.answers.length === 2, `追问的回答也渲染出来了（共 ${p.answers.length} 段）`);
  /* ⚠ 别把第一轮那条「任务+资料」也当成问句渲染出来：它同样带 role:'user'，
     贴出去就是整份人物档案糊在页面上（实测曹操 20 条关系 + 16 条事件全被打印）。 */
  ok(!/【人物资料】/.test(p.questions.join('')), '第一轮的任务/资料没有被当成"用户问的"显示出来');

  console.log('\n▶ ⑤ 再追问一轮：历史累积，且不剧透约束仍在');
  await installFetch(['第一答', '第二答', '第三答']);
  await js(`(() => { const b = [...document.querySelectorAll('#panel [data-ai="char"]')][0]; b.click(); })()`);
  await wait(900);
  await js(`(() => { const i = document.querySelector('.ai-ask-input'); i.value = '第一问'; i.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); })()`);
  await wait(900);
  await js(`(() => { const i = document.querySelector('.ai-ask-input'); i.value = '第二问'; i.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); })()`);
  await wait(900);
  const c3 = await calls();
  ok(c3.length === 3, `一共 3 次请求（实际 ${c3.length}）`);
  ok(JSON.stringify(c3[2].roles) === JSON.stringify(['system', 'user', 'assistant', 'user', 'assistant', 'user']),
    `第 3 次带 6 条消息：${JSON.stringify(c3[2].roles)}`);
  ok(c3[2].texts[0] === c1[0].texts[0], '第 3 次的 system 仍然逐字相同');
  p = await panelState();
  ok(p.answers.length === 3, `三段回答都在页面上（实际 ${p.answers.length}）`);
  /* 点「讲一遍」是**重开一段新对话**：之前那轮的问句应当整个丢掉。
     这里重开后连问了两句，所以应该是 2 个问题，且不含上一轮那句。 */
  ok(p.questions.length === 2 && p.questions[0] === '第一问' && p.questions[1] === '第二问',
    `「讲一遍」重开 ⇒ 上一轮追问被丢弃，现在只有：${JSON.stringify(p.questions)}`);

  console.log('\n▶ ⑥ 请求失败：把这条提问撤掉，不留一条没回答的问句');
  /* ⚠ installFetch 会把 __calls 清零，所以这次失败的请求是**第 0 次**调用。
     第一版写成 ['答', null] 想"第二次失败"，结果第 0 次拿到了 '答' 成功返回，
     断言全红而我以为产品坏了 —— 其实是我的脚本把调用序号搞错了。 */
  await installFetch([null]);
  await js(`(() => { const i = document.querySelector('.ai-ask-input'); i.value = '会失败的一问'; i.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); })()`);
  await wait(1200);
  p = await panelState();
  ok(p.questions.length === 2 && !/会失败的一问/.test(p.questions.join('')),
    `失败的那句没留在页面上（现在 ${p.questions.length} 个问题：${JSON.stringify(p.questions)}）`);
  ok(!!p.err && /Failed to fetch/.test(p.err), `显示了错误原因（${p.err}）`);
  ok(/浏览器直连被拦/.test(p.err || ''), '并给出跨域这条常见原因的解释');
  const c4 = await calls();
  ok(c4.length === 1, `只发出了 1 次请求（实际 ${c4.length}）`);
  ok(c4[0].roles[0] === 'system' && c4[0].roles[c4[0].roles.length - 1] === 'user'
    && c4[0].texts[c4[0].texts.length - 1] === '会失败的一问',
    `请求本身已经带上了这句（撤的是页面显示与线程状态，不是否认发生过）：共 ${c4[0].roles.length} 条消息，末条是「${c4[0].texts[c4[0].texts.length - 1]}」`);

  console.log('\n▶ ⑦ 「清空对话」把整段追问收掉');
  await js(`(() => { const b = document.querySelector('[data-ai-ask-clear]'); if (b) b.click(); })()`);
  await wait(400);
  p = await panelState();
  ok(p.hidden && p.answers.length === 0, 'AI 区域收起来了');
  ok((await calls()).length === 1, '清空不发请求（纯本地）');

  console.log(`\n${failed ? '✗' : '✓'} AI 继续追问：${passed} 通过，${failed} 失败`);
} catch (e) { failed++; console.error('异常：' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')); }
finally {
  try { ws.close(); } catch { }
  try { proc.kill(); } catch { }
  try { server.close(); } catch { }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
}
if (passed + failed === 0) { console.error('✗ 一条断言都没跑到（中途崩了？）'); process.exit(1); }
process.exit(failed ? 1 : 0);