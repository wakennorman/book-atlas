/**
 * 给 test/*.mjs 的 CDP `send()` 补超时 —— 补齐 v0.115 的第 4 项。
 *
 * ## 为什么需要（这是 v0.98 守卫**没覆盖到**的另一种挂法）
 *
 * 已有的两道守卫：
 *   ① `if (!url)` —— Edge 没暴露 CDP 端点时立刻退出
 *   ② WebSocket 连接的 `Promise.race` 10 秒超时
 *
 * 这两道都只管**连上之前**。连上之后每一�� CDP 命令走的是：
 *     const send = (m, p = {}) => new Promise((resolve, reject) => {
 *       const id = ++seq; pending.set(id, { resolve, reject }); ws.send(...); });
 *     ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { ... } };
 * **响应如果不来，`pending` 里那个条目永远不 settle** ⇒ `await js(...)` 永远挂着
 * ⇒ 进程 stdout/stderr 0 字节、无异常、无退出码 —— 和注释里描述的挂法一模一样。
 *
 * 页面加载失败、Page.navigate 卡住、Runtime.evaluate 打到一个死掉的 target，
 * 都会走到这里。而守卫只在"连上之前"生效。
 *
 * ★ 我自己的检测一开始是错的：正则写成 `setTimeout\([^)]*reject`，
 *   `[^)]*` 撞上第一个 `)` 就断了，于是报告成"一个都没有"。
 *   实际有 8 个文件本来就有超时。**这就是这整轮在消灭的那类错误自己又犯一次。**
 *   所以下面这个脚本改成直接看 `send` 那一行里有没有 `setTimeout`。
 *
 * 用法：node scripts/add-send-timeout.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const TEST = path.join(ROOT, 'test');
const MS = 30000;

let fixed = 0, already = 0;

for (const f of fs.readdirSync(TEST).filter((x) => x.endsWith('.mjs'))) {
  const p = path.join(TEST, f);
  const src = fs.readFileSync(p, 'utf8');
  if (!/const send = /.test(src)) continue;          // 没有 send 的文件不管

  const has = /const send = [^\n]*setTimeout/.test(src);
  if (has) { already++; continue; }

  /* 目标形态：在 ws.send 之后挂一个定时器，超时就把 pending 条目删掉并 reject。 */
  const lines = src.split(/\r?\n/);
  let hit = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/const send = /.test(lines[i])) continue;

    /**
     * ⚠ 第一版把 setTimeout 插到了箭头函数的**外面**（`});` 之后）。
     *   `node --check` 照样通过（语法合法），但 `id` / `reject` / `method`
     *   变成了模块作用域，是 ESLint 的 no-undef 抓出来的。
     *   ⇒ 纯文本插入必须同时过 `node --check` **和** `eslint`，
     *     只过前者等于没验。
     *
     * 现在改成：在 `ws.send(...)` 之后、**同一个箭头函数体内**插入，
     * 位置由 `ws.send(` 之后的第一个 `});` 决定 —— 那就是函数体的结束。
     */
    const from = lines[i].indexOf('ws.send(');
    if (from < 0) {
      /* 跨行写法（ws.send 在别的行），这版脚本不处理，交给人工 */
      continue;
    }
    const after = lines[i].slice(from + 'ws.send('.length);
    const closeAt = after.search(/\}\s*\);/);
    if (closeAt < 0) continue;

    const at = from + 'ws.send('.length + closeAt;
    lines[i] = lines[i].slice(0, at)
      + ` /* v0.115：CDP 响应不来时 pending 条目永不 settle ⇒ 静默挂死。 */ `
      + `setTimeout(() => { if (pending.delete(id)) reject(new Error(method + ' ${MS / 1000} 秒无响应')); }, ${MS});`
      + lines[i].slice(at);
    hit++;
    break;
  }
  if (!hit) { console.log(`  ⛔ ${f}：找到了 const send 但插不进去，需人工看`); continue; }
  console.log(`  ${f}：补上 send 超时（${MS / 1000} 秒）`);
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
  fixed++;
}

console.log(`\n补 ${fixed} 个，本来就有 ${already} 个`);
console.log(WRITE ? '已写入' : '预览模式（加 --write 才落盘）');
