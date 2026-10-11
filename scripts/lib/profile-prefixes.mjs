/**
 * Temp 下「本仓库自己开的临时目录」前缀表 —— **唯一来源**（v0.192）。
 *
 * ## 为什么要有这个文件
 *
 * 2026-10-11 用户报「C 盘又变红了」。查下来 Temp 里有 **224 个** `ba-*-<6位随机>` 目录、
 * 合计 **14.56 GB**，全是本项目浏览器测试留下的 profile。
 *
 * 根因不是"回收逻辑坏了"，是**回收白名单漂了**：
 * `test/_profile-guard.mjs` 的 `PROFILE_PREFIXES` 是手写的，
 * 而 `test/gen-fill.mjs` / `band-labels.mjs` / `annotations.mjs` / `fullscreen.mjs` /
 * `browser-locator.mjs` 后来才加进来，各自 `mkdtempSync` 的前缀**没被补进白名单** ⇒
 * `sweepStaleProfiles()` 认不出它们，一次都没回收过。
 * 实测泄漏量：`ba-fill-` 62 个 / 7.76 GB · `ba-anno-` 82 个 / 3.10 GB · `ba-band-` 62 个 / 3.12 GB。
 *
 * ⚠ 该文件自己的注释早就写着「新增脚本时把前缀加进来，否则它的泄漏没人兜底」——
 *   但**没有任何东西在守这句话**。手写清单 + 无人对拍 = 必然漂移（本仓库反复踩的同一族）。
 *
 * ## 现在谁守它
 *
 * `test/profile-prefix-guard.mjs`：扫全仓的 `mkdtempSync(…os.tmpdir()…, '<前缀>')`，
 * 与这份表**双向**对拍 ——
 *   · 抓到的前缀必须被某条表项覆盖（否则**新脚本又漏了**，就是这次 14.56 GB 的成因）；
 *   · 每条表项必须覆盖到某个抓到的前缀（否则是**打字错误或脚本已删**，表项永远不会生效）。
 *
 * ## 为什么单独一个文件（而不是留在 `test/_profile-guard.mjs` 里）
 *
 * ① `test/guard-hygiene.mjs` 的 H2 要求守卫 import 至少一个 `scripts/` 下的模块
 *    （证明它测的是真判据）—— 表放这儿，守卫 import 它即可，不必为了满足 H2 去凑一个假 import；
 * ② 白名单本身是**数据**，被"清扫"和"守卫"两个消费者共用 ⇒ 按铁律 7，它只能有一份。
 *
 * ## 安全性：这份表是**白名单**，不是「凡 `ba-` 皆可删」
 *
 * 两个理由：
 *   · `%TEMP%\opencode\ba-books\` 存着三本书的**原著 txt**（不进版本库、丢了要重新找）；
 *   · Temp 下还有别人的 `ba-*`（别的工具、用户自己的东西）。
 * 所以只认下面这些**以 `-` 结尾**的前缀（`ba-books` 不匹配任何一条，见守卫的自检断言）。
 */

/**
 * 本仓库在 `os.tmpdir()` 下 `mkdtempSync` 时用的前缀。
 *
 * ⚠ 每一条都必须**以 `-` 结尾**：这样 `ba-rel-` 不会误吞 `ba-relations-x`，
 *   也让"表项是不是打字错误"这件事在肉眼上一眼可辨。
 * ⚠ 新增一个会开 Temp 目录的脚本 ⇒ 必须把前缀加进来，否则 `test/profile-prefix-guard.mjs` 报红。
 */
export const PROFILE_PREFIXES = [
  /* ── 会 spawn 无头 Edge 的测试：每个 profile 几十 ~ 上百 MB，是泄漏的主体 ── */
  'ba-ai-', 'ba-anno-', 'ba-band-', 'ba-br-', 'ba-bv-', 'ba-cur-',
  'ba-det-', 'ba-ed-', 'ba-fill-', 'ba-fs-', 'ba-hist-', 'ba-lock-',
  'ba-parity-', 'ba-place-', 'ba-pv-', 'ba-race-', 'ba-rel-', 'ba-relax3-',
  'ba-roam-', 'ba-scale-', 'ba-smoke-', 'ba-tip-', 'ba-tut-', 'ba-vm-',
  /* ── 只开个空目录当"假仓库根/临时目录"的台账守卫：体积可忽略，
   *    但它们**同样**在 Temp 下开 `ba-*` ⇒ 一并收进白名单，免得下次又有人只补一半。 ── */
  'ba-actors-guard-', 'ba-anl-', 'ba-cc-', 'ba-dupnames-', 'ba-firstch-',
  'ba-kte-', 'ba-ledgerq-', 'ba-mok-', 'ba-nfl-', 'ba-scv-', 'ba-vb-',
];

/**
 * 这个名字是不是"本仓库自己的临时目录"。
 * ⚠ 用 `startsWith` 而不是正则：`mkdtempSync` 的后缀是 6 位随机字符，
 *   但 `version-bump-guard.mjs` 用的是 `ba-vb-plain-`（多一段），正则很容易漏。
 *
 * ⚠ 写成 `export function` 而不是 `export const ... = () =>`：
 *   `test/guard-hygiene.mjs` 的 H3 要求"被守卫 import 的 `scripts/` 模块必须**导出函数**"
 *   （判据是 `/^export\s+(?:async\s+)?function\s+(\w+)/m`）—— 箭头函数常量过不了那一关。
 * @param {string} name Temp 下的一个条目名
 * @returns {boolean}
 */
export function isOwnTempName(name) {
  return PROFILE_PREFIXES.some((p) => String(name).startsWith(p));
}

/**
 * 浏览器**自己**留在 Temp 的自清失败残留 —— 第二张表，与上面的白名单**分开**。
 *
 * ## 为什么要有第二张表（v0.192）
 *
 * Chromium 内核的浏览器只在**优雅退出**时自清这些目录；我们测试里 `proc.kill()` 是强杀，
 * 它来不及 ⇒ 每跑一轮测试就漏一批。v0.192 实测存量：
 * `msedge_*`（组件解包残留，如 `msedge_chrome_Unpacker_BeginUnzipping…`）1355 个 / 5.18 GB、
 * `scoped_dir*`（扩展安装残留，如 `scoped_dir102984_…/CRX_INSTALL`）74 个 / 2.14 GB。
 * 这些**同样是本项目测试造成的**，不兜底的话 C 盘还会再红一次。
 *
 * ## 为什么和 `PROFILE_PREFIXES` 分开、且闸更保守（24 小时）
 *
 *   · 这两个前缀**不是我们发明的**：用户自己开的 Edge / 其他 Chromium 应用也会用它们
 *     ⇒ 绝不能混进「我们的 profile」那张表里，否则语义就糊了（"本仓库 mkdtemp 的目录"）；
 *   · 误删一个**正在用的**浏览器临时目录，浏览器会出怪病 ⇒ mtime 闸放宽到 24 小时
 *     （在用的目录会被浏览器持续触碰，24 小时没动过的基本是死的；
 *     真被占用时 `rmSync` 也会失败 ⇒ 调用方跳过，不会硬删）。宁可漏删，不可误删。
 */
export const BROWSER_LEFTOVERS = ['msedge_', 'scoped_dir'];

/**
 * 这个名字是不是「浏览器自清失败的残留」（**不是**本仓库 mkdtemp 的目录）。
 * @param {string} name Temp 下的一个条目名
 * @returns {boolean}
 */
export function isBrowserLeftover(name) {
  return BROWSER_LEFTOVERS.some((p) => String(name).startsWith(p));
}
