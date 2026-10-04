// 临时浏览器 profile 的防泄漏守卫 —— 供所有会 spawn 无头 Edge 的测试/脚本共用。
//
// 为什么要它：这些脚本一律 `mkdtempSync(os.tmpdir(), 'ba-xxx-')` 开一份全新 profile，
// 收尾时 `proc.kill()` 之后**立刻** `fs.rmSync` —— kill 只是发信号，Edge 还没退出、
// profile 仍被文件锁占用 → rmSync 抛错 → 被空 `catch {}` 静默吞掉 → 目录永久留在 Temp。
// 稳定性测试还常在超时轮次直接强杀进程（连 finally 都进不去）。
// 两者叠加实测过：24 小时泄漏 1012 个目录 / 60.5 GB，把 200GB 的 C 盘吃到只剩 0.3GB。
//
// 两个函数分工：
//   releaseProfile(profile) —— 每次运行收尾时调：反复重试删除，等 Edge 自己退干净。
//   sweepStaleProfiles()    —— 每次运行开始时调：兜底回收历史泄漏（含被强杀的那一轮）。
//
// 删除安全：sweep 只认下面这份**白名单前缀**（不认泛 `ba-`），且必须同时通过两道闸：
//   ① 进程表里没有任何浏览器的 --user-data-dir 指向它（并发会话正在用的绝不动）
//   ② 最后写入时间 > 30 分钟（在用的 profile 会被浏览器持续写入，mtime 恒新）
// 任一不满足就跳过。宁可漏删，不可误删。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// 与各脚本的 mkdtempSync 前缀一一对应。新增脚本时把前缀加进来，否则它的泄漏没人兜底。
export const PROFILE_PREFIXES = [
  'ba-roam-', 'ba-br-', 'ba-ai-', 'ba-cur-', 'ba-ed-', 'ba-tip-',
  'ba-det-', 'ba-hist-', 'ba-vm-', 'ba-bv-', 'ba-parity-', 'ba-pv-',
  'ba-lock-', 'ba-place-', 'ba-race-', 'ba-rel', 'ba-scale-', 'ba-tut-',
];

/** 同步 sleep。Node 主线程允许 Atomics.wait；万一不可用就退化成忙等。 */
const sleepSync = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); return; } catch { /* 下面兜底 */ }
  const t = Date.now(); while (Date.now() - t < ms) { /* 忙等兜底 */ }
};

/** 当前被浏览器进程占用的 user-data-dir 集合。查不到就返回空集合（调用方只靠 mtime 判据）。 */
function browserHeldProfiles() {
  const held = new Set();
  try {
    const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'msedge|chrome' } | ForEach-Object { $_.CommandLine }"],
      { encoding: 'utf8', timeout: 5000, windowsHide: true }).stdout || '';
    for (const m of out.matchAll(/--user-data-dir="?([^"\s]+)/gi)) held.add(path.resolve(m[1]));
  } catch { /* 查不到进程表就只靠 mtime 判据，宁可漏删也不误删 */ }
  return held;
}

/**
 * 兜底清扫历史泄漏的 profile。在每次脚本运行、创建自己的 profile **之前**调用。
 * @returns {number} 实际回收的目录数
 */
export function sweepStaleProfiles({ staleMs = 30 * 60 * 1000, quiet = false } = {}) {
  let n = 0;
  try {
    const tmp = os.tmpdir();
    // 便宜的判断放前面：Temp 干净的时候（绝大多数运行）到这就返回了，
    // 不该为了查进程表每次都拉起 PowerShell。
    const stale = [];
    for (const name of fs.readdirSync(tmp)) {
      if (!PROFILE_PREFIXES.some((p) => name.startsWith(p))) continue;
      const p = path.join(tmp, name);
      try {
        if (Date.now() - fs.statSync(p).mtimeMs < staleMs) continue;
        stale.push(p);
      } catch { /* 目录被并发删了就跳过 */ }
    }
    if (stale.length === 0) return 0;

    // 只有真要删的时候才去查进程表：并发会话正在用的 profile 绝不动。
    const held = browserHeldProfiles();
    for (const p of stale) {
      try {
        if (held.has(path.resolve(p))) continue;
        fs.rmSync(p, { recursive: true, force: true });
        n++;
      } catch (e) {
        if (!quiet) console.log(`  (清扫跳过) ${path.basename(p)}: ${e.message}`);
      }
    }
  } catch (e) {
    if (!quiet) console.log('  (清扫失败) ' + e.message);
  }
  if (n && !quiet) console.log(`  (清扫) 回收历史泄漏 profile ${n} 个`);
  return n;
}

/**
 * 收尾删除单个 profile。调用方应已 proc.kill() 过；这里负责「等 Edge 真退干净再删」。
 * 同步实现，所以在顶层 finally、普通函数、async 函数里都能直接调，不需要 await。
 * @returns {boolean} 是否删干净
 */
export function releaseProfile(profile, { attempts = 10, delayMs = 300, quiet = false } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
      return true;
    } catch (e) {
      if (i === attempts - 1) {
        // 不再静默吞错 —— 这里被吞掉一次就是 1GB 泄漏。
        console.error(`\n⚠️ 临时 profile 清理失败（会泄漏，下次运行的 sweepStaleProfiles 兜底）：${profile}\n   ${e.message}`);
      } else if (!quiet) {
        sleepSync(delayMs);
      }
    }
  }
  return false;
}
