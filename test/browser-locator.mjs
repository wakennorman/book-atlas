/**
 * 找一个**跨平台**的无头浏览器可执行文件 —— v0.165 新增。
 *
 * ## 为什么要有这个
 *
 * 19 个走 CDP 的测试各自抄了一份「浏览器在哪」的判断，清一色是：
 *   const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', …]
 *     .find((p) => fs.existsSync(p));
 *   if (!EDGE) { console.log('(跳过) 找不到 Edge/Chrome'); process.exit(0); }
 *
 * 两条问题，第二个才是致命的：
 *   ① **只认 Windows 路径** ⇒ CI（Ubuntu 容器）里全部找不到，全部 exit 0 跳过
 *      ⇒ **CI 上这些测试等于一次都没真跑过**，门禁"全绿"是空的。
 *   ② `build.mjs` **漏了那道 `if (!EDGE)` 保护**（19 个里唯一的例外）⇒
 *      找不到浏览器时 `spawn(undefined)` 同步抛
 *      `The "file" argument must be of type string` ⇒ **整个 job 崩掉**，
 *      后面 14 个步骤全部 SKIP ⇒ 这才是 CI 从 2026-09-30 起一直红的原因
 *      （本地 55 步全绿，因为一直在 Windows 上跑）。
 *
 * ## 本模块的口径
 *
 * `findBrowser()` 按平台给出候选；`requireBrowser()` 额外做两件事：
 *   1. 找不到 → 打印**为什么**（哪些路径试过、当前平台是什么）并退出码 2
 *      （**不是 0** —— 找不到浏览器是环境缺陷，静默跳过才是"假绿"的根源；
 *       2 让 CI 明确红在"环境不对"而不是"断言过了"）。
 *   2. 找到 → 打印用了哪一个，排查"用的是不是我想的那个浏览器"用。
 *
 * ⚠ 退出码 2 是本项目的约定：`check.yml` 与 `tools/gate.mjs` 看到非 0 即失败。
 *   本地 Windows 上有 Edge ⇒ 一切照旧；只有真正缺浏览器时才会走到退出码 2。
 */
import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** 按当前平台列出候选：绝对路径 + 命令名（PATH 查找）。 */
export function browserCandidates(platform = process.platform) {
  if (platform === 'win32') {
    return {
      label: 'Edge/Chrome（Windows 绝对路径）',
      paths: [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ],
      cmds: [],
    };
  }
  if (platform === 'darwin') {
    return {
      label: 'Edge/Chrome（macOS 应用包）',
      paths: [
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ],
      cmds: [],
    };
  }
  // Linux / 其他：容器里装的通常在 PATH 上（msedge、chromium、chromium-browser、google-chrome）
  return {
    label: 'Edge/Chromium（PATH 命令名）',
    paths: [
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/snap/bin/chromium',
    ],
    cmds: ['microsoft-edge', 'microsoft-edge-stable', 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'],
  };
}

function onPath(cmd) {
  try {
    // `where`（win）/ `command -v`（posix）
    const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(probe, { stdio: 'ignore', shell: process.platform === 'win32' });
    return true;
  } catch { return false; }
}

/** 找到就返回可执行文件（绝对路径或命令名），找不到返回 null。 */
export function findBrowser(platform = process.platform) {
  const { paths, cmds } = browserCandidates(platform);
  for (const p of paths) if (fs.existsSync(p)) return p;
  for (const c of cmds) if (onPath(c)) return c;
  return null;
}

/**
 * 找不到就打印诊断并 **exit 2**。
 * ⚠ 不用 exit 0：静默跳过会让「浏览器测试」在 CI 上变成空跑，门禁全绿但什么都没测。
 * @param {{ exit?: (n:number)=>void, log?: (s:string)=>void }} [io] 只给测试用
 */
export function requireBrowser(platform = process.platform, io = {}) {
  const exit = io.exit || ((n) => process.exit(n));
  const log = io.log || ((s) => console.log(s));
  const found = findBrowser(platform);
  if (found) {
    log(`  浏览器：${found}`);
    return found;
  }
  const { label, paths, cmds } = browserCandidates(platform);
  log('');
  log('  ✗ 找不到可用的无头浏览器（环境缺陷，不是断言失败）');
  log(`    平台：${platform}　查找口径：${label}`);
  if (paths.length) log(`    试过的路径：\n      ${paths.join('\n      ')}`);
  if (cmds.length) log(`    试过的命令：${cmds.join('、')}`);
  log('');
  log('    修法：');
  log('      · Linux/CI：装一个（CI 里通常是 `npx playwright install --with-deps chromium`');
  log('        或 apt install chromium / microsoft-edge-stable），');
  log('        装完确认 `which chromium` 或 `which microsoft-edge` 有输出。');
  log('      · 本地 Windows：确认 Edge/Chrome 装在标准路径下。');
  log('');
  log('    ⚠ 这里**刻意退出码 2 而不是 0**：找不到浏览器就静默跳过，');
  log('       门禁会显示"通过"，但浏览器测试一条都没跑 —— 那才是假绿。');
  exit(2);
  return null; // 仅为让类型/流程完整（exit 之后不会真的走到这）
}

/**
 * Linux 上**必须**追加的启动标志（v0.165.4）。
 *
 * ## 为什么只有 Linux 要
 *
 * 2026-10-09 的实测：CI（ubuntu-latest）上
 *   `/usr/bin/microsoft-edge --version` 正常输出 `Microsoft Edge 154.0.4258.53`，
 * 说明**浏览器装好了、能跑**；但测试用
 *   `spawn(EDGE, ['--remote-debugging-port=…', '--headless=new', …])`
 *  拉起来之后，**CDP 端点始终不出现**（CI 日志：`CDP 没起来`），断言一条都没跑到。
 *
 * 而 19 个测试里只有本文件知道怎么起浏览器 —— 这正是该把标志收在这里的理由：
 * 之前 19 处各抄一份参数，改一处要改十九处。
 *
 * ## 两个标志各自的由来
 *
 * · `--no-sandbox`：Linux 上 Chromium 系的沙箱要靠 user namespace。
 *   容器 / 多数 CI runner 里它起不来 ⇒ 进程**直接退出**，表现就是"CDP 永远不出现"。
 *   Windows / macOS 上这个标志被忽略，所以只在 Linux 加。
 * · `--disable-dev-shm-usage`：容器里 `/dev/shm` 默认只有 64MB，
 *   浏览器渲染进程会因共享内存不足而崩。同样是 Linux 专有。
 *
 * ⚠ `--no-sandbox` 关掉的是浏览器沙箱这个安全边界。测试里跑的是本地静态页面，
 *   且只在 Linux/CI 上加，属于业界常规做法；本地 Windows 依然开着沙箱。
 *
 * @param {string} [platform] 只给测试用（便于按平台断言）
 * @returns {string[]} 要 spread 进 spawn 参数数组
 */
export function browserArgs(platform = process.platform) {
  return platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
}

/**
 * 真起一次浏览器并确认 CDP 端点出现 —— v0.165.4，check.yml 的自证步骤调它。
 *
 * ## 为什么需要它（上一版只验到一半就栽了）
 *
 * v0.165.3 的自证只跑了 `--version`：**浏览器能执行**。于是它绿了，
 * 而测试要的 `--remote-debugging-port` + `--headless=new` 这条路根本没人验过 ——
 * 结果是"自证绿、测试红"，我又花了一轮 CI 才定位。
 *
 * ⇒ 这里必须**用测试真正用的那套参数**起一次，并真的去敲 `/json/list`。
 * 起不来就把浏览器自己的 stderr 打出来（各测试文件原本是 `stdio: 'ignore'`，
 * 浏览器说什么全被扔了）。
 *
 * @returns {Promise<{ok: boolean, port?: number, url?: string, stderr?: string, secs?: number}>}
 */
export async function cdpSmoke(platform = process.platform, budgetMs = 30000) {
  const edge = findBrowser(platform);
  if (!edge) return { ok: false, stderr: '找不到浏览器' };

  const port = await new Promise((res, rej) => {
    const s = net.createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-smoke-'));
  const proc = spawn(edge, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', ...browserArgs(platform), 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const chunks = [];
  for (const s of [proc.stdout, proc.stderr]) s?.on('data', (d) => chunks.push(d));

  const probe = () => new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/list', headers: { Connection: 'close' } }, (r) => {
      let b = ''; r.on('data', (d) => { b += d; });
      r.on('end', () => { try { res(JSON.parse(b).find((x) => x.type === 'page')?.webSocketDebuggerUrl); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
  });

  const t0 = Date.now();
  let url = null;
  while (!url && Date.now() - t0 < budgetMs) {
    try { url = await probe(); } catch { await new Promise((r) => setTimeout(r, 300)); }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  try { proc.kill(); } catch { /* 忽略 */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }

  if (url) return { ok: true, port, url, secs };
  return {
    ok: false, port, secs,
    stderr: Buffer.concat(chunks).toString('utf8').slice(-3000).trim()
      || `（浏览器没吐出任何输出，${secs}s 内 CDP 端点没出现；进程退出码 ${proc.exitCode}）`,
  };
}
