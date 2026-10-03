import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// v89：锁定（搜索单个人物 / 两人关系）时图上**只画**锁定集合内的点与线。
// 起因：原先集合外的元素只是 opacity 调低继续画着，也没有 silent，而 zrender 的命中测试
// 不看 opacity —— 后画的淡线会把鼠标事件吃掉（三国实测"大多数线点不动、偶尔能点"）。
//
// 守住：① 系列里不含锁定集合外的元素 ② 跳数控件能改集合且有上限
//      ③ 解除后完整还原（点数/线数逐位相同、坐标逐位还原）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 19131, CDP_PORT = 19132;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) { console.log('  (跳过) 找不到 Edge/Chrome'); process.exit(0); }

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, rep) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rep.writeHead(404); rep.end(); return; }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(rep);
});
await new Promise((r) => server.listen(PORT, r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-lock-'));
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
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

const probe = () => js(`(() => {
  const ba = window.__ba, st = ba.state, ch = ba.chart();
  const gs = ch.getOption().series[0];
  const all = gs.data || [];
  const nodes = all.map((d) => d.id).filter((id) => !String(id).startsWith('__gen_'));
  const bands = all.filter((d) => String(d.id).startsWith('__gen_')).length;
  const links = gs.links || [];
  const lock = st.clickLock;
  return {
    locked: !!lock,
    depth: lock ? lock.depth : null,
    origin: lock ? lock.origin : null,
    nodes, nNodes: nodes.length, nBands: bands, nLinks: links.length,
    allNodes: st.book.characters.length,
    linkIds: links.map((l) => [l.source, l.target]),
    pos: [...st.pos.entries()].slice(0, 300).map(([k, v]) => k + ':' + v.x.toFixed(6) + ',' + v.y.toFixed(6)).join('|'),
  };
})()`);

const click = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.click(); })()`);
const fill = (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
/** 走真实的解除路径：**「重置」按钮**（v89 起不再是双击空白 —— 双击只复位视野） */
const unlockAll = async () => {
  await js(`(() => { const b = document.getElementById('reset-btn'); if (!b) throw new Error('no reset-btn'); b.click(); })()`);
  await wait(2600);
};
/** 双击空白：只复位视野，不解除锁定（v89） */
const dblBlank = async () => {
  await js(`(() => {
    const zr = window.__ba.chart().getZr();
    zr.handler.dispatch('dblclick', { zrX: 20, zrY: 20, target: null, offsetX: 20, offsetY: 20 });
  })()`).catch(() => {});
  await wait(1800);
};

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?book=three-kingdoms` });
  for (let i = 0; i < 240; i++) {
    if (await js(`!!(window.__ba && window.__ba.state.chart && window.__ba.state.book.characters.length>500)`).catch(() => false)) break;
    await wait(100);
  }
  await wait(2500);
  await js(`(()=>{const b=document.getElementById('spoiler-off'); if(b)b.click();})()`);
  await wait(1800);

  /* ================= ① 两人关系 ================= */
  console.log('\n▶ 两人关系 诸葛亮 → 刘备：图上只剩这条链');
  const baseA = await probe();
  ok(!baseA.locked, '初始没有锁定');
  console.log(`    基线：${baseA.nNodes} 点 + ${baseA.nBands} 个代际图注 / ${baseA.nLinks} 线（全书 ${baseA.allNodes} 人）`);

  await fill('#path-a', '诸葛亮'); await fill('#path-b', '刘备');
  await click('#path-go');
  await wait(2600);
  const path = await probe();
  ok(path.locked && path.origin === 'path', `已锁定（origin=${path.origin}）`);
  ok(path.nNodes === 2, `图上只剩 2 个点（实际 ${path.nNodes}）`);
  ok(path.nBands <= 2, `代际图注只保留真有节点的那几组（${path.nBands} / ${path.nBands} → ${baseA.nBands}）`);
  ok(path.nLinks === 9, `只剩刘备—诸葛亮之间的 9 条线（实际 ${path.nLinks}）`);
  ok(path.nNodes + path.nLinks <= 12, `图元总数 ${baseA.nNodes + baseA.nLinks} → ${path.nNodes + path.nLinks}`);
  ok(path.linkIds.every(([s, t]) =>
    (s === 'zhuge-liang' && t === 'liu-bei') || (s === 'liu-bei' && t === 'zhuge-liang')),
    '每条线的两端都是这两个人（没有混进无关的边）');
  ok(!(await js(`!!document.querySelector('#lock-bar [data-lock-depth]')`)),
    '两人关系锁不显示跳数控件（集合就是那条链）');

  await dblBlank();
  const stillLocked = await probe();
  ok(stillLocked.locked, '双击空白**不再**解除锁定（v89：双击只复位视野）');
  ok(stillLocked.nNodes === path.nNodes && stillLocked.nLinks === path.nLinks,
    `双击之后图还是那条链（${stillLocked.nNodes} / ${stillLocked.nLinks}）`);

  await click('#view-reset-btn');
  await wait(1800);
  const afterViewReset = await probe();
  ok(afterViewReset.locked, '「复位视图」也**不**解除锁定（两个动作都只是"找回视野"）');

  await unlockAll();
  const pathBack = await probe();
  ok(!pathBack.locked, '「重置」才解除锁定');
  ok(pathBack.nNodes === baseA.nNodes && pathBack.nLinks === baseA.nLinks,
    `图完整还原：${pathBack.nNodes} / ${pathBack.nLinks}（基线 ${baseA.nNodes} / ${baseA.nLinks}）`);
  ok(pathBack.pos === baseA.pos, '解除后坐标逐位还原（fitPositions 写回坐标的坑没踩到）');

  /* ================= ② 搜索锁定 ================= */
  console.log('\n▶ 搜索单个人物：只画跟他有关系的点和线');
  const baseB = await probe();          // ← 基线必须在**上锁前一刻**取
  await fill('#search-input', '诸葛亮');
  await click('#search-go');
  await wait(2600);
  const s1 = await probe();
  ok(s1.locked && s1.origin === 'search', `已锁定（origin=${s1.origin}, depth=${s1.depth}）`);
  ok(s1.nodes.includes('zhuge-liang'), '中心人物在图上');
  ok(s1.nNodes > 1 && s1.nNodes < baseB.nNodes,
    `图上只剩 ${s1.nNodes} 个点（上锁前 ${baseB.nNodes}）—— 他 + ${s1.nNodes - 1} 个直接相关的人`);
  ok(s1.nLinks < baseB.nLinks, `线从 ${baseB.nLinks} 降到 ${s1.nLinks}`);
  ok(s1.linkIds.every(([s, t]) => s1.nodes.includes(s) && s1.nodes.includes(t)),
    '每条线的两端都在图上的点集内（没有"看不见但挡路"的边）');
  console.log(`    ${s1.nNodes} 点 / ${s1.nLinks} 线（上锁前 ${baseB.nNodes} / ${baseB.nLinks}）`);

  /* ================= ③ 跳数控件 ================= */
  console.log('\n▶ 跳数 1 → 2 → 3');
  ok(await js(`!!document.querySelector('#lock-bar [data-lock-depth="inc"]')`), '有「＋跳」控件');
  ok(await js(`document.querySelector('#lock-bar [data-lock-depth="dec"]').disabled`), '1 跳时「−跳」禁用（下限就是 1）');
  await click('#lock-bar [data-lock-depth="inc"]'); await wait(2000);
  const s2 = await probe();
  ok(s2.depth === 2, `跳数变成 2（实际 ${s2.depth}）`);
  ok(s2.nNodes >= s1.nNodes, `点数随跳数不减：${s1.nNodes} → ${s2.nNodes}`);
  ok(s2.nNodes < s2.allNodes, `2 跳仍在全书范围内（${s2.nNodes} < ${s2.allNodes}）`);
  ok(s2.linkIds.every(([a, b]) => s2.nodes.includes(a) && s2.nodes.includes(b)), '2 跳时每条线的两端也都画出来了');
  await click('#lock-bar [data-lock-depth="inc"]'); await wait(2000);
  const s3 = await probe();
  ok(s3.depth === 3, `能到 3 跳（实际 ${s3.depth}）`);
  ok(await js(`document.querySelector('#lock-bar [data-lock-depth="inc"]').disabled`), '3 跳时「＋跳」禁用（上限就是 3）');
  await click('#lock-bar [data-lock-depth="dec"]'); await wait(1600);
  await click('#lock-bar [data-lock-depth="dec"]'); await wait(2000);
  const s1b = await probe();
  ok(s1b.depth === 1 && s1b.nNodes === s1.nNodes, `「−跳」退回 1 跳且点数复原（${s1b.depth} 跳 / ${s1b.nNodes} 点）`);

  /* ================= ④ 代价对比（信息性，不做断言） ================= */
  console.log('\n▶ 代价：锁定后重画一次 option 要多久');
  const cost = await js(`(() => {
    const ba = window.__ba, ch = ba.chart();
    const bench = (fn, n) => { fn(); const a = performance.now(); for (let i = 0; i < n; i++) fn(); return +((performance.now() - a) / n).toFixed(1); };
    const locked = bench(() => ch.setOption(ba._buildOption(), { notMerge: true }), 15);
    const gs = ch.getOption().series[0];
    const nNodes = (gs.data || []).length, nLinks = (gs.links || []).length;
    // 解锁后再量一次全图的
    const lock = ba.state.clickLock;
    ba.state.clickLock = null;
    const open = bench(() => ch.setOption(ba._buildOption(), { notMerge: true }), 15);
    const g2 = ch.getOption().series[0];
    const oNodes = (g2.data || []).length, oLinks = (g2.links || []).length;
    ba.state.clickLock = lock;
    ch.setOption(ba._buildOption(), { notMerge: true });
    return { locked, open, nNodes, nLinks, oNodes, oLinks };
  })()`);
  console.log(`    锁定时  ${cost.nNodes} 点 / ${cost.nLinks} 线 → 重画 ${cost.locked} ms`);
  console.log(`    未锁定  ${cost.oNodes} 点 / ${cost.oLinks} 线 → 重画 ${cost.open} ms`);
  console.log(`    ⇒ ${(cost.open / cost.locked).toFixed(1)}×（setOption 的成本对图元数是线性的）`);

  /* ================= ⑤ 解除还原 ================= */
  console.log('\n▶ 解除锁定：完整还原');
  await unlockAll();
  const back = await probe();
  ok(!back.locked, '锁定已解除');
  ok(back.nNodes === baseB.nNodes && back.nLinks === baseB.nLinks,
    `图完整还原：${back.nNodes} 点 / ${back.nLinks} 线（上锁前 ${baseB.nNodes} / ${baseB.nLinks}）`);
  ok(back.pos === baseB.pos, '坐标逐位还原');

  /* ================= ⑥ 两种锁互斥：换锁时清掉对方的残留输入 ================= */
  /* 用户报的现象：搜完一个人没点清除就去查两人关系，界面自相矛盾 ——
   * 搜索框里还写着上一个人，锁条上写的是两人关系；这时在搜索框敲回车还会静悄悄锁回去。
   * 状态本身不会"撞车"（两条路径都先 unlockClick 再重建），坏掉的是**输入框的残留**。 */
  console.log('\n▶ 两种锁互斥：换锁时把另一种查询的残留清掉');

  await fill('#search-input', '曹操');
  await click('#search-go');
  await wait(2600);
  ok(await js(`document.getElementById('search-input').value.trim() === '曹操'`), '搜索框里是「曹操」');

  await fill('#path-a', '刘备'); await fill('#path-b', '诸葛亮');
  await click('#path-go');
  await wait(2800);
  const cross1 = await probe();
  const sv = await js(`document.getElementById('search-input').value`);
  ok(cross1.locked && cross1.origin === 'path', `锁换成了两人关系（origin=${cross1.origin}）`);
  ok(sv === '', `搜索框里的「曹操」已被清掉（现在读作 "${sv}"）—— 否则界面自相矛盾、回车还会锁回去`);
  ok(await js(`document.getElementById('path-a').value.trim() === '刘备'`), '两人关系的输入保持不动');

  await fill('#search-input', '关羽');
  await click('#search-go');
  await wait(2800);
  const cross2 = await probe();
  const pa = await js(`document.getElementById('path-a').value`);
  const pb = await js(`document.getElementById('path-b').value`);
  ok(cross2.locked && cross2.origin === 'search', `锁换成了搜索（origin=${cross2.origin}）`);
  ok(pa === '' && pb === '', `两人关系输入也被清掉（path-a="${pa}" path-b="${pb}"）`);

  // 同一把锁重复查询不该被自己的清理误伤
  await fill('#search-input', '张飞');
  await click('#search-go');
  await wait(2600);
  ok(await js(`document.getElementById('search-input').value.trim() === '张飞'`), '又搜一个：输入框保持「张飞」');

  // 锁条上要写清解除路径，且不能再提「复位视图」
  const hint = await js(`(() => { const e = document.querySelector('#lock-bar .lock-hint'); return e ? e.textContent.trim() : ''; })()`);
  ok(hint.includes('重置') && hint.includes('清除'), `锁条给出了解除路径：「${hint}」`);
  ok(!hint.includes('复位视图'), '锁条不再把「复位视图」说成解除路径');

  await unlockAll();
  const fin = await probe();
  ok(!fin.locked, '最后「重置」能解除');

} catch (e) {
  failed++;
  console.error('  ✗ 异常：' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
} finally {
  try { ws.close(); } catch { /* 忽略 */ }
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

console.log(`\n${'='.repeat(40)}`);
console.log(`锁定只显示相关　通过：${passed}  失败：${failed}`);
process.exit(failed > 0 ? 1 : 0);