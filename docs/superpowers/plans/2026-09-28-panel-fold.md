# 长列表「展开 / 收起」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use /subagent-driven-development (recommended) or /executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网页端右侧档案与章节面板的长列表默认只显示"桌面舒适量"，超出部分收起，支持分批/全部展开、一键收起，`…还有 N 条`纯文本提示全部变成可点按钮。

**Architecture:** 在 `js/app.js` 加三个折叠基建函数（`foldVM` 算状态 → `foldSection` 生成带初始状态的 HTML → `applyFolds` 点击后原地刷新），配一个 document 级 `[data-fold]` 事件委托；把 7 处列表渲染改走 `foldSection`。**初始状态直接烤进 HTML**（超出当前显示数的条目在开标签后补 `hidden`），点击只对单个折叠段做 `hidden` 切换——**绝不重渲染整个面板**（否则会清掉 `#ai-answer` 里的 AI 讲解结果）。

**Tech Stack:** 原生 JS（IIFE + innerHTML 模板字符串）、原生 CSS（`mask-image` 渐隐、`[hidden]` 控制显隐）；验证 = `node --check` + 门禁五步 + harness 浏览器 DOM 断言（`tools.browser.evaluate` / `scroll` / `screenshot` / `console`）。

**规范（已获批）:** `docs/superpowers/specs/2026-09-28-panel-fold-design.md`

**版本:** 本轮 = **v0.72** → `CACHE = 'bookatlas-v72'`、`index.html` 两处 `?v=72`、`sw.js` SHELL 两处 `?v=72`。
依据 CHANGELOG 第 4 行：「版本号就是 `sw.js` 里的 `CACHE = 'bookatlas-vNN'`」。当前 CACHE 停在 **v68**（v0.69–v0.71 三轮改前端漏 bump，属既有事故）→ 本轮 bump 到 72 一并修复老访客停旧码的问题（详见 Task 7 发布信息）。

**发布约定（项目惯例，覆盖技能默认的 git commit）:** 本仓库**不做本地 commit**（本地 HEAD 与远端分叉，发布一律走 `tools\push-via-api.ps1`）；只有 Task 7 才发布。`_publish-*.ps1` 被 `.gitignore` 排除、不会上传。

**环境:**
- node 不在 PATH：`$node = "C:\Users\chw\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"`
- 本地预览：`python -m http.server 8765`（workdir = 仓库根；协调者已在本轮开始时启动）
- 浏览器：`tools.browser.tabs.open({ url: 'http://127.0.0.1:8765/?book=three-kingdoms' })` 之后所有工具都要带该 `tabID`。**URL 必须带 `?book=three-kingdoms`**：不带参数 `boot()` 取 `books[0]`＝百年孤独，`selectCharacter('cao-cao')` 会拿到空
- ⚠️ 执行期事实（2026-09-28 实测）：**子代理会话的 browser 工具返回 `browser.disconnected`** → 各 Task 的浏览器断言步骤由**协调者**执行，子代理只做代码改动 + shell 门禁；断言结果回填后交给评审者作为证据
- **Windows 中文 `.ps1` 必须带 UTF-8 BOM**（Task 7 重建发布脚本时用 `[IO.File]::WriteAllText(..., UTF8Encoding($true))`）

**约定的默认条数（spec §4）:** 与谁有关 **6** ｜ 他的一生 **8** ｜ 本章新关系 **10** ｜ 初次登场 **16** ｜ 关系卡/关系链/地点 **10** ｜ 本章事件、关系内部事件行、重大事件轴 **不折**。

---

### Task 1: 折叠基建（state + 三个函数 + 事件委托 + CSS）

**Files:**

- Modify: `js/app.js`（4 处：state 定义、esc 之后加函数、`loadBook` 重置、`#path-go` 前加委托）
- Modify: `css/style.css`（1 处：`.life-list .quote` 之后加 `.fold` 样式块）

- [x] **Step 0: 冲突预检**

Run（PowerShell）:
```powershell
$node = "C:\Users\chw\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
Select-String -Path "D:\Claude Code+DeepSeekV4\book-atlas\js\app.js" -Pattern "foldSection|foldVM|applyFolds|FOLD_BATCH|data-fold" -CaseSensitive:$false
```
Expected: **无输出**（0 处匹配）。若有匹配，把本计划里所有 `foldVM / foldSection / applyFolds / FOLD_BATCH / FOLD_ONESTEP / data-fold / data-fold-key / fold-body / fold-head / fold-foot / fold-btn / fold-alt / fold-more` 统一改名后再继续。

- [x] **Step 1: `state` 加 `fold`**

Edit `js/app.js`：

oldString:
```
    viewCenter: [0, 0],      // 视角中心（graph series 的 center；0,0 = 节点云中心）
    labelTimer: null,
  };
```
newString:
```
    viewCenter: [0, 0],      // 视角中心（graph series 的 center；0,0 = 节点云中心）
    labelTimer: null,
    fold: {},                // 长列表折叠：key -> 当前显示条数（缺省＝默认收起）
  };
```

- [x] **Step 2: 三个基建函数（插在 `esc` 定义之后）**

Edit `js/app.js`：

oldString:
```
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
```
newString（在该行之后追加）:
```
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ---- 长列表「展开/收起」（规范：docs/superpowers/specs/2026-09-28-panel-fold-design.md）---- */
  const FOLD_BATCH = 20;     // 超长列表每次「再显示」的条数
  const FOLD_ONESTEP = 40;   // 总数 ≤ 此值时一键展开（不分批）

  // 折叠段的视图模型：按 state.fold[key] 算当前显示几条、按钮文案与语义
  function foldVM(key, n, unit, total) {
    const shown = Math.min(Math.max(state.fold[key] || n, n), total);
    const open = shown > n;
    const full = shown >= total;
    let act = 'more';
    const step = Math.min(FOLD_BATCH, total - shown);   // 最后一批常不足 20，文案必须说真话
    let text = `再显示 ${step} ${unit}（${shown} / ${total}）`;
    if (full) { act = 'collapse'; text = '⌃ 收起'; }
    else if (total <= FOLD_ONESTEP) { act = 'all'; text = `⌄ 展开全部 ${total} ${unit}`; }
    return { shown, open, full, act, text };
  }

  // 把"已渲染好的条目 HTML 数组"包成可折叠段；总数 ≤ n 时原样返回（不折）
  // opts: { key, n, unit, cls, wrap('ul'|'div'), bare(不折时 true＝不包外层), items }
  function foldSection(opts) {
    const { key, n, unit = '条', cls = '', wrap = 'ul', bare = false, items } = opts;
    const total = items.length;
    if (total <= n) return bare ? items.join('') : `<${wrap} class="${cls}">${items.join('')}</${wrap}>`;
    const v = foldVM(key, n, unit, total);
    const bid = `fold-${String(key).replace(/[^a-zA-Z0-9]+/g, '-')}`;
    // 超出当前显示数的条目，在开标签后补 hidden（条目都是我们自己拼的开标签：要同时认 <li>/<button>/<div>，否则关系卡 bare 模式的 div 条目烘不上 hidden）
    const body = items.map((h, i) => {
      if (i < v.shown) return h;
      const out = h.replace(/^(\s*<[a-zA-Z][\w-]*)/, '$1 hidden');
      if (out === h) console.warn('foldSection: 条目未以开标签开头，hidden 烘焙失败（会漏到首屏）', key, i);
      return out;
    }).join('');
    return `<section class="fold${v.open ? ' is-open' : ''}" data-fold-key="${esc(key)}" data-n="${n}" data-unit="${esc(unit)}">
      <div class="fold-head"${v.open ? '' : ' hidden'}><button class="fold-btn" type="button" data-fold="${esc(key)}" data-fold-act="collapse" aria-expanded="${v.open}" aria-controls="${bid}">⌃ 收起</button></div>
      <${wrap} class="${cls} fold-body${v.full ? '' : ' is-cut'}" id="${bid}">${body}</${wrap}>
      <div class="fold-foot">
        <button class="fold-btn" type="button" data-fold="${esc(key)}" data-fold-act="${v.act}" aria-expanded="${v.open}" aria-controls="${bid}">${v.text}</button>
        <button class="fold-btn fold-alt" type="button" data-fold="${esc(key)}" data-fold-act="all" aria-expanded="${v.open}" aria-controls="${bid}"${total > FOLD_ONESTEP && !v.full ? '' : ' hidden'}>全部展开</button>
      </div>
    </section>`;
  }

  // 点击后原地刷新一个折叠段：只切 hidden 与按钮文案，不重渲染面板（AI 结果等状态不丢）
  function applyFolds(sec) {
    if (!sec || !sec.classList || !sec.classList.contains('fold')) return;
    const key = sec.dataset.foldKey;
    const n = Number(sec.dataset.n) || 6;
    const unit = sec.dataset.unit || '条';
    const foldBody = sec.querySelector('.fold-body');
    if (!foldBody) return;
    const kids = [...foldBody.children];
    const v = foldVM(key, n, unit, kids.length);
    kids.forEach((el, i) => { el.hidden = i >= v.shown; });
    sec.classList.toggle('is-open', v.open);
    foldBody.classList.toggle('is-cut', !v.full);
    const head = sec.querySelector('.fold-head');
    if (head) head.hidden = !v.open;
    const foot = sec.querySelectorAll('.fold-foot .fold-btn');
    if (foot[0]) {
      foot[0].dataset.foldAct = v.act;
      foot[0].textContent = v.text;
      foot[0].setAttribute('aria-expanded', String(v.open));
    }
    if (foot[1]) {
      foot[1].hidden = !(kids.length > FOLD_ONESTEP && !v.full);
      foot[1].setAttribute('aria-expanded', String(v.open));
    }
    const headBtn = head && head.querySelector('.fold-btn');
    if (headBtn) headBtn.setAttribute('aria-expanded', String(v.open));
  }
```

- [x] **Step 3: `loadBook` 清空折叠状态**

Edit `js/app.js`：

oldString:
```
    state.placeFilter = null;
    state.rank = null;
    state.focus = null;
```
newString:
```
    state.placeFilter = null;
    state.rank = null;
    state.focus = null;
    state.fold = {};                    // 换书后清空长列表展开状态
```

- [x] **Step 4: document 级事件委托（插在 `#path-go` 绑定之前，初始化只跑一次）**

Edit `js/app.js`：

oldString:
```
    $('#path-go').addEventListener('click', runPath);
```
newString:
```
    // 长列表「展开/收起」（document 级委托：面板都是 innerHTML 重建的）
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-fold]');
      if (!btn) return;
      const sec = btn.closest('.fold');
      if (!sec) return;
      const key = sec.dataset.foldKey;
      const n = Number(sec.dataset.n) || 6;
      const foldBody = sec.querySelector('.fold-body');
      const total = foldBody ? foldBody.children.length : 0;
      const shown = Math.min(Math.max(state.fold[key] || n, n), total);
      const act = btn.dataset.foldAct;
      if (act === 'collapse') {
        delete state.fold[key];
        applyFolds(sec);
        sec.scrollIntoView({ block: 'nearest' });   // 收起后段首回到视野，人不丢
      } else if (act === 'all') {
        state.fold[key] = total;
        applyFolds(sec);
      } else {
        state.fold[key] = Math.min(shown + FOLD_BATCH, total);
        applyFolds(sec);
      }
    });

    $('#path-go').addEventListener('click', runPath);
```

- [x] **Step 5: CSS（`css/style.css`，插在 `.life-list .quote` 之后）**

Edit `css/style.css`：

oldString:
```
  .life-list .quote { margin-top: 4px; font-size: 12.5px; }
```
newString:
```
  .life-list .quote { margin-top: 4px; font-size: 12.5px; }

  /* ---------- 长列表折叠（展开/收起） ---------- */
  .fold { position: relative; }
  .fold-head { display: flex; justify-content: flex-end; margin: 6px 0 4px; }
  .fold-foot { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .fold-btn {
    border: 1px solid var(--line); background: var(--soft); color: var(--ink);
    border-radius: var(--radius-s); padding: 5px 12px; font-size: 12.5px; cursor: pointer;
  }
  .fold-btn:hover { border-color: var(--muted); }
  .fold-alt { background: transparent; color: var(--muted); }
  .fold [hidden] { display: none !important; }   /* 作者样式可能盖过 UA 的 [hidden]，保险 */
  .fold-body.is-cut {                            /* 截断时底部渐隐，提示「下面还有」 */
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 44px), transparent 100%);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 44px), transparent 100%);
  }
  body[data-fontsize="l"] .fold-btn { font-size: 14px; }
```

- [x] **Step 6: 语法检查**

Run:
```powershell
$node = "C:\Users\chw\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $node --check "D:\Claude Code+DeepSeekV4\book-atlas\js\app.js"
```
Expected: 无输出、退出码 0。

- [x] **Step 7: 本地冒烟（此时调用点还没改，页面应与改前一致）**

Run（后台起服务）:
```powershell
python -m http.server 8765
```
（workdir = `D:\Claude Code+DeepSeekV4\book-atlas`，background）

浏览器：
1. 打开/复用 `http://127.0.0.1:8765/?book=three-kingdoms` 标签 → 记下 `tabID`（协调者执行）
2. `tools.browser.evaluate({ tabID, script })`:

```js
(() => {
  window.__ba.selectCharacter('cao-cao');
  return {
    foldType: typeof window.__ba.state.fold,
    title: window.__ba.state.book.meta.title,
    relHeading: document.getElementById('panel').textContent.includes('与谁有关'),
    foldCount: document.querySelectorAll('#panel .fold').length,
  };
})()
```
Expected: `{ foldType: 'object', title: '三国演义', relHeading: true, foldCount: 0 }`（Task 1 阶段还没有调用点）。
3. `tools.browser.console({ tabID, level: 'error' })` → Expected: `messages: []`。

---

### Task 2: 人物档案两段（与谁有关 / 他的一生）

**Files:**

- Modify: `js/app.js:1346-1369`（`lifeHtml` + `relHtml` 定义）
- Modify: `js/app.js:1404`（`<ul class="rel-list">` 渲染）

- [x] **Step 0: 确认 `relHtml` 有两处，只改档案面板这处**

Run:
```powershell
Select-String -Path "D:\Claude Code+DeepSeekV4\book-atlas\js\app.js" -Pattern "relHtml"
```
Expected: 恰好 4 处命中 —— `1357`（定义）、`1404`（使用）＝本轮要改；`2212`（定义）、`2230`（使用）在**EPUB/导出的「人物志」**里（非交互面板）**不改**。若行号有漂移，以「`const relHtml = rels.map((r) => {` 后面跟着 `const other = ...` + `charLink(other)`」认档案面板这一处。

- [x] **Step 1: 「他的一生」→ foldSection（N=8）**

Edit `js/app.js`：

oldString:
```
    const lifeHtml = lifeEvs.length ? `
      <h3 style="margin-top:12px;font-size:14px">他的一生（按章，${lifeShown.length}/${lifeEvs.length}）</h3>
      <ul class="life-list">${lifeShown.slice(0, 40).map((e) => `
        <li><button class="linkbtn" type="button" data-event="${esc(e.id)}"><span class="ch">第 ${e.ch ?? '?'} 章</span>${esc(e.name)}</button>
          <div class="rel-event">· ${esc(e.summary)}${e.place ? ` <button class="linkbtn" type="button" data-place-filter="${esc(e.place)}">📍${esc(placeName(e.place))}</button>` : ''}</div>
          ${e.quote ? `<div class="quote">「${esc(e.quote)}」</div>` : ''}
        </li>`).join('')}${lifeShown.length > 40 ? `<li class="hint">…还有 ${lifeShown.length - 40} 个事件（可用阶段轴看全）</li>` : ''}</ul>
      ${lifeEvs.length > lifeShown.length ? `<p class="hint">🔒 还有 ${lifeEvs.length - lifeShown.length} 个事件在你读到的进度之后</p>` : ''}` : '';
```
newString:
```
    const lifeItems = lifeShown.map((e) => `
        <li><button class="linkbtn" type="button" data-event="${esc(e.id)}"><span class="ch">第 ${e.ch ?? '?'} 章</span>${esc(e.name)}</button>
          <div class="rel-event">· ${esc(e.summary)}${e.place ? ` <button class="linkbtn" type="button" data-place-filter="${esc(e.place)}">📍${esc(placeName(e.place))}</button>` : ''}</div>
          ${e.quote ? `<div class="quote">「${esc(e.quote)}」</div>` : ''}
        </li>`);
    const lifeHtml = lifeEvs.length ? `
      <h3 style="margin-top:12px;font-size:14px">他的一生（按章，${lifeShown.length}/${lifeEvs.length}）</h3>
      ${foldSection({ key: `life:${c.id}`, n: 8, unit: '个', cls: 'life-list', items: lifeItems })}
      ${lifeEvs.length > lifeShown.length ? `<p class="hint">🔒 还有 ${lifeEvs.length - lifeShown.length} 个事件在你读到的进度之后</p>` : ''}` : '';
```
（原「…还有 N 个事件（可用阶段轴看全）」提示被折叠按钮取代、删除；🔒 进度提示保留且在 fold 之外。）

- [x] **Step 2: `relHtml` → `relItems` 数组（去掉 `.join('')`）**

Edit `js/app.js`：

oldString:
```
    const relHtml = rels.map((r) => {
      const other = r.from === c.id ? r.to : r.from;
      const vis = visibleRelEvents(r);
      const hidden = (r.events || []).length - vis.length;
      const evs = vis.map((e) =>
        `<div class="rel-event">· ${e.place ? `<span class="chapter">📍${esc(placeName(e.place))}</span> ` : ''}${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
      return `<li class="rel">
        <div class="rel-head">${charLink(other)} <span class="type">— ${esc(r.type)} —</span>${kinBadge(r)}${isDerived(r) ? ' <span class="badge">推导</span>' : ''}${periodText(r) ? ` <span class="badge">${esc(periodText(r))}</span>` : ''}
          <button class="ghost tiny" type="button" data-focus-rel="${esc(r.from)}|${esc(r.to)}" title="在图上只高亮这一条关系">定位这条线</button>
        </div>
        ${evs}${hidden ? `<div class="rel-event">🔒 还有 ${hidden} 条事件在你读到的进度之后</div>` : ''}
      </li>`;
    }).join('');
```
newString:
```
    const relItems = rels.map((r) => {
      const other = r.from === c.id ? r.to : r.from;
      const vis = visibleRelEvents(r);
      const hidden = (r.events || []).length - vis.length;
      const evs = vis.map((e) =>
        `<div class="rel-event">· ${e.place ? `<span class="chapter">📍${esc(placeName(e.place))}</span> ` : ''}${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
      return `<li class="rel">
        <div class="rel-head">${charLink(other)} <span class="type">— ${esc(r.type)} —</span>${kinBadge(r)}${isDerived(r) ? ' <span class="badge">推导</span>' : ''}${periodText(r) ? ` <span class="badge">${esc(periodText(r))}</span>` : ''}
          <button class="ghost tiny" type="button" data-focus-rel="${esc(r.from)}|${esc(r.to)}" title="在图上只高亮这一条关系">定位这条线</button>
        </div>
        ${evs}${hidden ? `<div class="rel-event">🔒 还有 ${hidden} 条事件在你读到的进度之后</div>` : ''}
      </li>`;
    });
```
（唯一改动：`const relHtml` → `const relItems`，末尾去掉 `.join('')`。）

- [x] **Step 3: `<ul class="rel-list">` → foldSection（N=6）**

Edit `js/app.js`：

oldString:
```
      <ul class="rel-list">${relHtml || '<li class="hint">暂无记录</li>'}</ul>
```
newString:
```
      ${relItems.length ? foldSection({ key: `rel:${c.id}`, n: 6, unit: '条', cls: 'rel-list', items: relItems }) : '<ul class="rel-list"><li class="hint">暂无记录</li></ul>'}
```

- [x] **Step 4: 语法检查**

Run:
```powershell
$node = "C:\Users\chw\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $node --check "D:\Claude Code+DeepSeekV4\book-atlas\js\app.js"
```
Expected: 无输出、退出码 0。

- [x] **Step 5: 浏览器断言（曹操：默认条数 / 分批 / 全部展开 / 收起回段首 / AI 结果不丢 / 切人再回保持）**

`tools.browser.evaluate({ tabID, script })`（若页面未加载先 reload）:

```js
(() => {
  const b = window.__ba;
  const rd = (key) => {
    const s = document.querySelector(`#panel [data-fold-key="${key}"]`);
    if (!s) return null;
    const fb = s.querySelector('.fold-body');
    return {
      n: +s.dataset.n, total: fb.children.length,
      visible: [...fb.children].filter((c) => !c.hidden).length,
      foot0: s.querySelector('.fold-foot .fold-btn').textContent.trim(),
      aria0: s.querySelector('.fold-foot .fold-btn').getAttribute('aria-expanded'),
      headHidden: s.querySelector('.fold-head').hidden,
      altHidden: s.querySelector('.fold-foot .fold-alt').hidden,
    };
  };
  const tap = (key, act) => {
    const s = document.querySelector(`#panel [data-fold-key="${key}"]`);
    const btn = s && s.querySelector(`[data-fold-act="${act}"]`);
    if (btn) btn.click();
    return !!btn;
  };
  b.selectCharacter('cao-cao');
  const life0 = rd('life:cao-cao');
  const rel0 = rd('rel:cao-cao');
  const ai = document.getElementById('ai-answer');
  ai.hidden = false; ai.innerHTML = '<p id="ai-probe">PROBE</p>';
  const t1 = tap('rel:cao-cao', 'more');
  const relMore = rd('rel:cao-cao');
  const probe1 = !!document.getElementById('ai-probe');
  const t2 = tap('rel:cao-cao', 'all');
  const relAll = rd('rel:cao-cao');
  const probe2 = !!document.getElementById('ai-probe');
  const t3 = tap('rel:cao-cao', 'collapse');
  const relCollapse = rd('rel:cao-cao');
  const probe3 = !!document.getElementById('ai-probe');
  tap('rel:cao-cao', 'all');
  b.selectCharacter('liu-bei');
  b.selectCharacter('cao-cao');
  const relBack = rd('rel:cao-cao');
  return { life0, rel0, taps: [t1, t2, t3], relMore, relAll, relCollapse, relBack,
    probes: [probe1, probe2, probe3],
    stateKeys: Object.keys(b.state.fold) };
})()
```
Expected（逐项核对）:
- `life0`: `{ n: 8, visible: 8, total: >= 40, foot0: '再显示 20 个（8 / N）'（unit＝个，实测曹操 196 条一生事件）, aria0: 'false', headHidden: true, altHidden: false }`
- `rel0`: `{ n: 6, visible: 6, total: >= 40, foot0: '再显示 20 条（6 / N）', aria0: 'false', headHidden: true }`（total 受关系过滤影响不锁定精确值；全量统计是 261）
- `taps`: `[true, true, true]`
- `relMore.visible === rel0.total 起点 6 + 20 = 26`，`foot0 === '再显示 20 条（26 / N）'`
- `relAll`: `visible === total`、`foot0 === '⌃ 收起'`、`aria0 === 'true'`、`headHidden === false`、`altHidden === true`
- `relCollapse`: `visible === 6`、`headHidden === true`、`foot0 === '再显示 20 条（6 / N）'`
- `probes === [true, true, true]`（AI 结果全程没被清）
- `relBack.visible === relBack.total`（切人再回来，展开状态**由 HTML 烘焙还原**，且 `foot0 === '⌃ 收起'`）
- `stateKeys` 含 `'rel:cao-cao'`（值 = total）、**不含** `'life:cao-cao'`

- [x] **Step 6: 收起时"段首滚回视口"断言**

`tools.browser.evaluate`:
```js
(() => {
  window.__ba.selectCharacter('cao-cao');
  const s = document.querySelector('#panel [data-fold-key="rel:cao-cao"]');
  const tap = (key, act) => { const el = document.querySelector(`#panel [data-fold-key="${key}"] [data-fold-act="${act}"]`); if (el) el.click(); return !!el; };
  tap('rel:cao-cao', 'all');                     // 先展开（页面变长）
  window.scrollTo(0, document.body.scrollHeight); // 滚到页底
  tap('rel:cao-cao', 'collapse');                // 收起 → 段首应滚回视野
  const r = s.getBoundingClientRect();
  return { top: Math.round(r.top), vh: window.innerHeight, inView: r.top >= -10 && r.top <= window.innerHeight };
})()
```
Expected: `{ top: 介于 -10 与 vh 之间, inView: true }`。

---

### Task 3: 章节面板两段（本章新关系 / 初次登场）

**Files:**

- Modify: `js/app.js:1643`（`✨ 初次登场`）
- Modify: `js/app.js:1644`（`🤝 本章新关系`）

- [x] **Step 1: 「初次登场」→ foldSection（N=16，chips 用 div 包）**

Edit `js/app.js`：

oldString:
```
        ${d.charsNew.length ? `<div class="ch-sec"><h4>✨ 初次登场</h4><div class="ch-chips">${d.charsNew.map((c) => `<button class="ch-chip" type="button" data-goto="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div></div>` : ''}
```
newString:
```
        ${d.charsNew.length ? `<div class="ch-sec"><h4>✨ 初次登场</h4>${foldSection({ key: `newchars:${n}`, n: 16, unit: '个', cls: 'ch-chips', wrap: 'div', items: d.charsNew.map((c) => `<button class="ch-chip" type="button" data-goto="${esc(c.id)}">${esc(c.name)}</button>`) })}</div>` : ''}
```

- [x] **Step 2: 「本章新关系」→ foldSection（N=10，删掉 `…还有 N 条` 文本）**

Edit `js/app.js`：

oldString:
```
        ${d.relsNew.length ? `<div class="ch-sec"><h4>🤝 本章新关系（${d.relsNew.length}）</h4><ul class="ch-list">${d.relsNew.slice(0, 12).map((r) => `<li><button class="linkbtn" type="button" data-focus-rel="${esc(r.from)}|${esc(r.to)}">${esc(charName(r.from))} — ${esc(r.type)} — ${esc(charName(r.to))}</button></li>`).join('')}${d.relsNew.length > 12 ? `<li class="hint">…还有 ${d.relsNew.length - 12} 条</li>` : ''}</ul></div>` : ''}
```
newString:
```
        ${d.relsNew.length ? `<div class="ch-sec"><h4>🤝 本章新关系（${d.relsNew.length}）</h4>${foldSection({ key: `chrels:${n}`, n: 10, unit: '条', cls: 'ch-list', items: d.relsNew.map((r) => `<li><button class="linkbtn" type="button" data-focus-rel="${esc(r.from)}|${esc(r.to)}">${esc(charName(r.from))} — ${esc(r.type)} — ${esc(charName(r.to))}</button></li>`) })}</div>` : ''}
```

- [x] **Step 3: 语法检查**

Run:
```powershell
$node = "C:\Users\chw\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $node --check "D:\Claude Code+DeepSeekV4\book-atlas\js\app.js"
```
Expected: 无输出、退出码 0。

- [x] **Step 4: 浏览器断言（新关系最多章 / 新人物最多章 / `…还有` 彻底消失 / 本章事件不折）**

`tools.browser.evaluate`:
```js
(() => {
  const b = window.__ba;
  const chapters = b.state.book.meta.chapters;
  let rMax = { n: 1, c: 0 }, cMax = { n: 1, c: 0 };
  for (let n = 1; n <= chapters; n++) {
    const d = b.chapterDigest(n);
    if (d.relsNew.length > rMax.c) rMax = { n, c: d.relsNew.length };
    if (d.charsNew.length > cMax.c) cMax = { n, c: d.charsNew.length };
  }
  const rdSec = (prefix) => {
    const s = document.querySelector(`#chapter-body [data-fold-key^="${prefix}"]`);
    if (!s) return null;
    const fb = s.querySelector('.fold-body');
    return { n: +s.dataset.n, total: fb.children.length,
      visible: [...fb.children].filter((c) => !c.hidden).length,
      foot0: s.querySelector('.fold-foot .fold-btn').textContent.trim() };
  };
  b.goChapter(rMax.n);
  const rel0 = rdSec('chrels:');
  const relBtn = document.querySelector('#chapter-body [data-fold-key^="chrels:"] .fold-foot .fold-btn');  // 段尾主按钮：段首收起钮是 hidden 的，点它无效
  if (relBtn) relBtn.click();
  const rel1 = rdSec('chrels:');
  const eventsFold = !!document.querySelector('#chapter-body [data-fold-key^="chevents:"]');
  b.goChapter(cMax.n);
  const chips = rdSec('newchars:');
  return { rMax, cMax, rel0, rel1, chips, eventsFold,
    ellipsisLeft: document.body.textContent.includes('…还有') };
})()
```
Expected:
- `rMax.c >= 25`（按关系事件统计的单章新关系峰值，用户实测见过 29）
- `rel0 = { n: 10, visible: 10, total: rMax.c, foot0: '再显示 20 条（10 / ' + rMax.c + '）' }`
- `rel1.visible === Math.min(30, rMax.c)`（分批步长 20）
- `cMax.c >= 17`、`chips = { n: 16, visible: 16, total: cMax.c }`
- `eventsFold === false`（本章事件不折）
- `ellipsisLeft === false`（`…还有` 纯文本提示全站消失）

---

### Task 4: 兜底三处（关系卡 / 关系链 / 地点面板）

**Files:**

- Modify: `js/app.js:1415-1416` + `1419-1421`（`renderRelationPanel`）
- Modify: `js/app.js:1313-1316`（`renderPlacePanel`）
- Modify: `js/app.js:1472-1485`（`runPath`）

- [x] **Step 1: 关系卡事件列表 → foldSection（N=10，`bare` 不折时不包外层，DOM 与现状一致）**

Edit `js/app.js`（第一处 —— `evs` 定义）：

oldString:
```
    const evs = (r.events || []).map((e) =>
      `<div class="rel-event">· ${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
```
newString:
```
    const evItems = (r.events || []).map((e) =>
      `<div class="rel-event">· ${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`);
```

Edit `js/app.js`（第二处 —— 模板里的 `${evs || ...}`）：

oldString:
```
      ${periodText(r) ? `<p class="card-sub">关系时段：<b>${esc(periodText(r))}</b>${state.timeTravel ? `　<span class="hint">（图谱现在拨在第 ${state.chapter} 章）</span>` : ''}</p>` : ''}
      ${evs || '<p class="hint">暂无记录</p>'}
```
newString:
```
      ${periodText(r) ? `<p class="card-sub">关系时段：<b>${esc(periodText(r))}</b>${state.timeTravel ? `　<span class="hint">（图谱现在拨在第 ${state.chapter} 章）</span>` : ''}</p>` : ''}
      ${evItems.length ? foldSection({ key: `relev:${first}|${second}`, n: 10, unit: '条', cls: 'rel-events', wrap: 'div', bare: true, items: evItems }) : '<p class="hint">暂无记录</p>'}
```

- [x] **Step 2: 地点面板 → foldSection（N=10）**

Edit `js/app.js`：

oldString:
```
      <ul class="rel-list">${evs.length ? evs.map((e) => `<li class="rel">
        <div class="rel-head">${esc(e.name)} <span class="type">第 ${e.ch ?? '?'} 章</span></div>
        <div class="rel-event">· ${esc(e.summary)}</div>
      </li>`).join('') : '<li class="hint">暂无（或都在你读到的进度之后）</li>'}</ul>
```
newString:
```
      ${evs.length ? foldSection({ key: `place:${id}`, n: 10, unit: '条', cls: 'rel-list', items: evs.map((e) => `<li class="rel">
        <div class="rel-head">${esc(e.name)} <span class="type">第 ${e.ch ?? '?'} 章</span></div>
        <div class="rel-event">· ${esc(e.summary)}</div>
      </li>`) }) : '<ul class="rel-list"><li class="hint">暂无（或都在你读到的进度之后）</li></ul>'}
```

- [x] **Step 3: 关系链 → foldSection（N=10，key `path:a|b`）**

Edit `js/app.js`：

oldString:
```
    const html = steps.map((s, i) => {
      const vis = visibleRelEvents(s.rel);
      const hidden = (s.rel.events || []).length - vis.length;
      const evs = vis.map((e) =>
        `<div class="rel-event">· ${e.place ? `<span class="chapter">📍${esc(placeName(e.place))}</span> ` : ''}${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
      return `<li class="rel">
        <div class="rel-head"><span class="idx">${i + 1}</span> ${charLink(s.from)} <span class="type">— ${esc(s.rel.type)} —</span>${kinBadge(s.rel)} ${charLink(s.to)}</div>
        ${evs}${hidden ? `<div class="rel-event">🔒 还有 ${hidden} 条事件在你读到的进度之后</div>` : ''}
      </li>`;
    }).join('');
    panel().innerHTML = `
      <div class="card-title">关系链：${esc(charName(a))} → ${esc(charName(b))}</div>
      <p class="card-sub">共 ${steps.length} 跳 · 每一跳的「关系」与依据事件</p>
      <ul class="path-steps">${html || '<li class="hint">同一个人</li>'}</ul>
```
newString:
```
    const stepItems = steps.map((s, i) => {
      const vis = visibleRelEvents(s.rel);
      const hidden = (s.rel.events || []).length - vis.length;
      const evs = vis.map((e) =>
        `<div class="rel-event">· ${e.place ? `<span class="chapter">📍${esc(placeName(e.place))}</span> ` : ''}${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
      return `<li class="rel">
        <div class="rel-head"><span class="idx">${i + 1}</span> ${charLink(s.from)} <span class="type">— ${esc(s.rel.type)} —</span>${kinBadge(s.rel)} ${charLink(s.to)}</div>
        ${evs}${hidden ? `<div class="rel-event">🔒 还有 ${hidden} 条事件在你读到的进度之后</div>` : ''}
      </li>`;
    });
    panel().innerHTML = `
      <div class="card-title">关系链：${esc(charName(a))} → ${esc(charName(b))}</div>
      <p class="card-sub">共 ${steps.length} 跳 · 每一跳的「关系」与依据事件</p>
      ${stepItems.length ? foldSection({ key: `path:${a}|${b}`, n: 10, unit: '跳', cls: 'path-steps', items: stepItems }) : '<ul class="path-steps"><li class="hint">同一个人</li></ul>'}
```
（注意：本步**同时**把模板里的 `${html || ...}` 换成上面的三元表达式，上面的 oldString 已覆盖到该行。）

- [x] **Step 4: 语法检查**

Run:
```powershell
$node = "C:\Users\chw\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $node --check "D:\Claude Code+DeepSeekV4\book-atlas\js\app.js"
```
Expected: 无输出、退出码 0。

- [x] **Step 5: 浏览器断言（关系卡 17 条事件折叠 / 关系链正常 / 三国地点不折）**

`tools.browser.evaluate`:
```js
(() => {
  const b = window.__ba;
  const out = {};
  // ① 关系卡：刘关张结义兄弟 17 条事件 → 折叠显示 10
  out.relOk = b.selectRelation('liu-bei', 'guan-yu');
  const s1 = document.querySelector('#panel .fold');
  out.card = s1 && { key: s1.dataset.foldKey, n: +s1.dataset.n,
    total: s1.querySelector('.fold-body').children.length,
    visible: [...s1.querySelector('.fold-body').children].filter((c) => !c.hidden).length };
  // ② 关系链
  document.getElementById('path-a').value = 'cao-cao';
  document.getElementById('path-b').value = 'liu-bei';
  document.getElementById('path-go').click();
  out.path = { text: document.getElementById('panel').textContent.includes('关系链'),
    foldCount: document.querySelectorAll('#panel .fold').length };
  // ③ 地点面板（三国单地点最多 3 条 → 不应折叠）
  b.selectCharacter('cao-cao');
  const placeBtn = [...document.querySelectorAll('#panel [data-place-filter]')].find((el) => el.dataset.placeFilter);
  if (placeBtn) { placeBtn.click(); }
  else {
    const psel = document.getElementById('place-filter');
    if (psel && psel.options.length > 1) { psel.value = psel.options[1].value; psel.dispatchEvent(new Event('change')); }
  }
  out.place = { heading: document.getElementById('panel').textContent.includes('在这里发生的事'),
    foldCount: document.querySelectorAll('#panel .fold').length };
  return out;
})()
```
Expected:
- `relOk === true`；`card = { key: 'relev:liu-bei|guan-yu', n: 10, total: 17, visible: 10 }`
- `path.text === true`；`path.foldCount === 0`（最短路径 ≤10 跳，兜底不触发属正常）
- `place.heading === true`；`place.foldCount === 0`（三国单地点 ≤3 条）

---

### Task 5: 版本号三处 + README + CHANGELOG + spec 措辞

**Files:**

- Modify: `index.html:23,521`
- Modify: `sw.js:2,28,29`
- Modify: `README.md:24`
- Modify: `CHANGELOG.md`（插入 v0.72 段 + `（未发布）` 标签批量修正）
- Modify: `docs/superpowers/specs/2026-09-28-panel-fold-design.md`（§4 一处措辞）

- [x] **Step 1: `index.html` 两处 `?v=68` → `?v=72`**

Edit `index.html`：

oldString: `<link rel="stylesheet" href="css/style.css?v=68">`
newString: `<link rel="stylesheet" href="css/style.css?v=72">`

Edit `index.html`：

oldString: `<script src="js/app.js?v=68"></script>`
newString: `<script src="js/app.js?v=72"></script>`

- [x] **Step 2: `sw.js` CACHE + SHELL**

Edit `sw.js`：

oldString: `const CACHE = 'bookatlas-v68';`
newString: `const CACHE = 'bookatlas-v72';`

oldString: `  './css/style.css?v=68',`
newString: `  './css/style.css?v=72',`

oldString: `  './js/app.js?v=68',`
newString: `  './js/app.js?v=72',`

- [x] **Step 3: 版本号回读核对（对外数字必须回读）**

Run:
```powershell
Select-String -Path "D:\Claude Code+DeepSeekV4\book-atlas\index.html","D:\Claude Code+DeepSeekV4\book-atlas\sw.js" -Pattern "\?v=|CACHE"
```
Expected（逐条）:
- `index.html`: `css/style.css?v=72`、`js/app.js?v=72`（两处，**不得残留 `?v=68`**）
- `sw.js`: `const CACHE = 'bookatlas-v72'`；`./css/style.css?v=72`、`./js/app.js?v=72`；`./editor.html?v=30` 等**编辑器 `?v=30` 不变**；`./js/app.js`（无版本条目）保持原样

- [x] **Step 4: README 功能表补一句**

Edit `README.md`：

oldString:
```
| **人物志 · 人物卡** | 点人物＝档案 + 按章排的「**他的一生**」（事件 · 地点 · 原文引文）+ 关系列表；「**🖼 人物卡**」把这个人导成 PNG（身份、结局、关键关系与依据事件），吃剧透保护 |
```
newString:
```
| **人物志 · 人物卡** | 点人物＝档案 + 按章排的「**他的一生**」（事件 · 地点 · 原文引文）+ 关系列表；**列表过长默认只显示舒适量（与谁有关 6 条 / 他的一生 8 条），可「展开全部 / 收起」**，超 40 条可分批「再显示 20 条」；「**🖼 人物卡**」把这个人导成 PNG（身份、结局、关键关系与依据事件），吃剧透保护 |
```

- [x] **Step 5: CHANGELOG —— 先把陈旧的 `（未发布）` 标签改掉**

Edit `CHANGELOG.md`：

oldString: `（未发布）`
newString: `（已上线 · 2026-09-28）`
replaceAll: **true**（预期命中 11 处：v0.71→v0.61 的 11 个标题；实测 v0.59–v0.71 全部已在线上，标签是发布说明整理时遗留的陈旧值）

- [x] **Step 6: CHANGELOG 插入 v0.72 段**

Edit `CHANGELOG.md`：

oldString:
```
## v0.71（已上线 · 2026-09-28）· 阅读伴侣 EPUB
```
newString:
```
## v0.72（已上线 · 2026-09-28）· 长列表展开/收起

- 右侧与章节面板的长列表改为**默认舒适量 → 展开/收起**（三国曹操 261 条关系不再一滑到底）：
  | 段 | 默认显示 | 说明 |
  |---|---|---|
  | 与谁有关·凭什么事件 | 6 条 | 原先完全不截断 |
  | 他的一生 | 8 条 | 原先硬截 40 且「…还有」不可点 |
  | 本章新关系 | 10 条 | 原先截 12、「…还有 N 条」不可点 → 现在可点 |
  | 初次登场 | 16 个 | 原先全铺（单章最多 39） |
  | 关系卡 / 关系链 / 地点面板 | 10 条 | 兜底，一般不触发 |
  | 本章事件 / 关系内部事件行 / 重大事件轴 | 不折 | 实测量小（≤7 / 中位 1 / 已有内部滚动） |
- 超 40 条分批：`再显示 20 条（6 / 261）` + `全部展开`；≤40 一键展开；到全量后按钮变 `⌃ 收起`（**段首也放一个**，不用滑回段首）
- 截断处**底部渐隐**提示还有内容；收起时该段**滚回段首**（人不丢）
- `aria-expanded` / `aria-controls` 齐全（读屏可念）；**🔒 进度锁定提示保持只读**，展开不能绕过剧透保护
- 实现：`foldVM / foldSection / applyFolds` + document 级 `[data-fold]` 委托（`js/app.js`），**初始状态烘焙进 HTML、点击原地切 `hidden` 不重渲染面板**（保住 AI 讲解结果）
- **顺手修缓存事故**：v0.69–v0.71 三轮改了前端却漏 bump `CACHE`（一直停在 v68）→ `sw.js` 字节没变 → SW 不重装 → **更早访问过的老访客一直跑 v0.68 代码**（无色盲配色/键盘导航/EPUB）。本轮 bump 到 **v72** 触发 SW 更新重装，一并修复
- 同步把上面几条旧记录的`（未发布）`改为`（已上线 · 2026-09-28）`（实测均已在线上）
- 规格：`docs/superpowers/specs/2026-09-28-panel-fold-design.md`；验证：门禁五步 + 浏览器断言（默认条数/分批步长/aria/收起滚动/AI 结果不丢/切人保持/换书清空）+ 线上复验 `sw=bookatlas-v72`

## v0.71（已上线 · 2026-09-28）· 阅读伴侣 EPUB
```

> ⚠️ **发布依赖**：此段先写成`（已上线 · 2026-09-28）`是因为同一轮 Task 7 会立刻发布。**若 Task 7 发布失败**，必须回来把该标题改回 `## v0.72（未发布）· 长列表展开/收起`，不得让 CHANGELOG 宣称未上线的东西已上线。

- [x] **Step 7: spec §4 措辞对齐（实现折的是"关系链跳数"，不是"每跳事件"）**

Edit `docs/superpowers/specs/2026-09-28-panel-fold-design.md`：

oldString: `| 关系卡事件 / 关系链每跳事件 / 地点事件 | **10** | 兜底，一般不触发 |`
newString: `| 关系卡事件 / 关系链跳数 / 地点事件 | **10** | 兜底，一般不触发 |`

- [x] **Step 8: 文档回读**

Run:
```powershell
Select-String -Path "D:\Claude Code+DeepSeekV4\book-atlas\CHANGELOG.md" -Pattern "未发布"
```
Expected: `未发布` 恰好 **1 处**，且必须是**正文 bullet**（v0.72 段里「同步把上面几条旧记录的`（未发布）`改为…」这条叙述性引用）。再跑：
```powershell
Select-String -Path "D:\Claude Code+DeepSeekV4\book-atlas\CHANGELOG.md" -Pattern "^## .*(未发布)"
```
Expected: **0 处** —— **没有任何版本标题**再挂「未发布」，这才是本步的真正目的；另 `^## v0.72` 一行须为 `## v0.72（已上线 · 2026-09-28）· 长列表展开/收起`。
（本断言执行期修正过：原写「`未发布` 0 处」与 Step 6 newString 自带的叙述性引用自相矛盾；v0.72 标题的`已上线`标签有发布依赖，见 Step 6 的警告。）

---

### Task 6: 门禁五步 + 全套浏览器验证 + 截图

**Files:** 无代码改动（纯验证；发现问题回到对应 Task 修）

- [x] **Step 1: 门禁第 1 步 —— JS 语法（与 check.yml 完全一致）**

Run:
```powershell
$node = "C:\Users\chw\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$root = "D:\Claude Code+DeepSeekV4\book-atlas"
foreach ($f in @("js/app.js","js/editor.js","miniprogram/utils/graph.js","miniprogram/utils/render.js","miniprogram/utils/card.js","miniprogram/pages/index/index.js","miniprogram/app.js")) {
  & $node --check "$root\$f"; if ($LASTEXITCODE -ne 0) { throw "FAIL $f" }
}
"OK"
```
Expected: 输出 `OK`。

- [x] **Step 2: 门禁第 2 步 —— 数据校验**

Run:
```powershell
& $node "D:\Claude Code+DeepSeekV4\book-atlas\scripts\validate.mjs" --all
```
Expected: 退出码 0、输出含 `0 error`（warning 是既有 lint 噪音，忽略）。

- [x] **Step 3: 门禁第 3 步 —— 搜索命中率审计**

Run:
```powershell
& $node "D:\Claude Code+DeepSeekV4\book-atlas\scripts\audit-search.mjs" --all
```
Expected: 退出码 0。

- [x] **Step 4: 门禁第 4 步 —— 小程序数据包同步**

Run:
```powershell
& $node "D:\Claude Code+DeepSeekV4\book-atlas\scripts\check-packs-sync.mjs"
```
Expected: 退出码 0（本轮不动 `data/**`，应直接通过）。

- [x] **Step 5: 门禁第 5 步 —— 小程序冒烟**

Run:
```powershell
& $node "D:\Claude Code+DeepSeekV4\book-atlas\miniprogram\test\smoke.mjs"
```
Expected: 退出码 0、全过（`✓ 全部通过（小程序页面逻辑冒烟）`）。
> 执行期修正：原写「52 项」是陈旧数字，实测 `smoke.mjs` 为 **59 个 `ok(` 断言、59 项全过**、0 失败——以退出码 0 + 无 ✗ 为准。

- [x] **Step 6: 剧透锁定只读断言（把进度拨到第 5 章）**

`tools.browser.evaluate`（**加锁前**先量一次全量，稍后做前后对比）:
```js
(() => {
  const b = window.__ba;
  b.selectCharacter('cao-cao');
  const s = document.querySelector('#panel [data-fold-key^="rel:"]');
  return { progress: b.state.progress, totalFull: s.querySelector('.fold-body').children.length };
})()
```
Expected: `progress === null`、`totalFull` ≥ 40（受关系过滤影响不硬编码；全量统计口径是 261）。

`tools.browser.evaluate`（**加锁到第 5 章**再量，同一脚本内完成展开测试）:
```js
(() => {
  const b = window.__ba;
  b.goChapter(5);
  const mark = document.querySelector('#chapter-body [data-ch-mark]');
  if (mark) mark.click();
  b.selectCharacter('cao-cao');
  const s = document.querySelector('#panel [data-fold-key^="rel:"]');
  const fb = s.querySelector('.fold-body');
  const lockEls = [...fb.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent.startsWith('🔒 还有'));
  const lockedP = [...document.querySelectorAll('#panel .hint')].find((el) => el.textContent.includes('🔒 还有') && el.textContent.includes('关系'));
  const before = { visible: [...fb.children].filter((c) => !c.hidden).length, total: fb.children.length };
  const btn = s.querySelector('[data-fold-act="all"]') || s.querySelector('[data-fold-act="more"]');
  if (btn) btn.click();
  const after = [...fb.children].filter((c) => !c.hidden).length;
  return {
    progress: b.state.progress,
    before, after,
    lockIsStatic: lockEls.every((el) => el.tagName !== 'BUTTON' && !el.closest('button')),
    lockedHintOutsideFold: lockedP ? !s.contains(lockedP) : null,
    foldTotal: fb.children.length,
  };
})()
```
Expected:
- `progress === 5`
- **`foldTotal` 必须小于上一步的 `totalFull`**（第 5 章之后锁定的关系根本没进列表，展开也看不到——这是剧透保护的正断言）
- `before.visible === 6`（收起态；rel 段 n=6 —— 原写 10 是把别的段的 n 抄错了，执行期实测 17>6 折叠显示 6 修正）、`after === foldTotal`（展开生效）
- `lockIsStatic === true`（🔒 提示是纯文本，不是按钮）
- `lockedHintOutsideFold === true`（`🔒 还有 N 条关系…` 在 fold 之外，不受展开影响）

- [x] **Step 7: 恢复进度（关剧透保护）**

`tools.browser.evaluate`:
```js
(() => {
  document.getElementById('spoiler-off').click();
  return { progress: window.__ba.state.progress };
})()
```
Expected: `{ progress: null }`。

- [x] **Step 8: 换书清空折叠状态 + 百年孤独地点折叠（N=10 兜底正例）**

`tools.browser.evaluate`（调用 A：触发换书）:
```js
(() => {
  const sel = document.getElementById('book-select');
  sel.value = 'one-hundred-years-of-solitude';
  sel.dispatchEvent(new Event('change'));
  return { picked: sel.value, slugNow: window.__ba.state.book.meta.slug };
})()
```
Expected: `picked === 'one-hundred-years-of-solitude'`（`slugNow` 可能还是 `three-kingdoms`，加载是异步的）。

`tools.browser.evaluate`（调用 B：轮询，最多重复 5 次直到命中）:
```js
(() => ({ slug: window.__ba.state.book.meta.slug, foldKeys: Object.keys(window.__ba.state.fold) }))()
```
Expected（命中时）: `{ slug: 'one-hundred-years-of-solitude', foldKeys: [] }`（**换书清空** ✓）。

`tools.browser.evaluate`（调用 C：百年孤独找事件最多的地点 → 应折叠）:
```js
(() => {
  const b = window.__ba;
  const counts = {};
  for (const e of b.state.book.events) if (e.place) counts[e.place] = (counts[e.place] || 0) + 1;
  const top = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
  const psel = document.getElementById('place-filter');
  psel.value = top[0];
  psel.dispatchEvent(new Event('change'));
  const s = document.querySelector('#panel .fold');
  return {
    pid: top[0], evCount: top[1],
    heading: document.getElementById('panel').textContent.includes('在这里发生的事'),
    key: s && s.dataset.foldKey, n: s && +s.dataset.n,
    total: s && s.querySelector('.fold-body').children.length,
    visible: s && [...s.querySelector('.fold-body').children].filter((c) => !c.hidden).length,
  };
})()
```
Expected: `evCount === 13`（百年孤独单地点峰值）、`heading === true`、`key === 'place:' + pid`、`n === 10`、`total === 13`、`visible === 10`。

- [x] **Step 9: 切回三国 + 视觉截图（截断渐隐 / 深色 / 字号大）**

1. `tools.browser.evaluate`:
```js
(() => {
  const sel = document.getElementById('book-select');
  sel.value = 'three-kingdoms';
  sel.dispatchEvent(new Event('change'));
  return 'switching';
})()
```
2. 轮询 B（同 Step 8）直到 `slug === 'three-kingdoms'`。
3. `tools.browser.evaluate`:
```js
(() => { window.__ba.selectCharacter('cao-cao'); window.scrollTo(0, 0); return 'ok'; })()
```
4. `tools.browser.screenshot({ tabID })` → **收起态**：能看到 6 条关系 + 底部渐隐 + 按钮（期望：图片返回 server-local 路径即成功；人眼确认最后一段文字向下淡出、按钮清晰不被遮罩盖住）
5. 点「全部展开」后再 `screenshot({ tabID })` → **展开态**
6. 深色主题：`tools.browser.evaluate({ script: "(() => { document.documentElement.setAttribute('data-theme','dark'); return 'dark'; })()" })` → `screenshot` → 人眼确认渐隐用的是深色面板色（不出现白色蒙层）→ 再 evaluate 改回 `'light'`
7. 字号大：`tools.browser.evaluate({ script: "(() => { document.body.dataset.fontsize = 'l'; return 'l'; })()" })` → `screenshot` → 人眼确认按钮 14px、条目变大后渐隐仍在 → 改回 `'m'`

- [x] **Step 10: 手机断点静态检查（工具限制，如实记录）**

Run:
```powershell
Select-String -Path "D:\Claude Code+DeepSeekV4\book-atlas\css\style.css" -Pattern "\.fold|@media"
```
Expected:
- `.fold` 系列规则**全部不含视口单位**（`vw/vh/@media` 内不出现 `.fold` 规则）——折叠是断点无关设计，手机上同样"默认 6 条 + 展开"
- `@media` 块本轮**零改动**（只改了 `max-height` 等既有规则的话即为异常）

> 说明：harness 浏览器工具没有视口缩放/设备模拟能力（已确认工具清单），因此 spec §7 的"手机断点看一眼"降级为静态检查——`.fold` 不依赖视口宽度，此结论仅凭代码结构成立，**不冒充实测**。

- [x] **Step 11: 控制台零错误**

`tools.browser.console({ tabID, level: 'error', limit: 50 })`
Expected: `messages: []`。

---

### Task 7: 发布（v72）+ 线上复验 + memory

**Files:**

- Create/Overwrite: `tools\_publish-now.ps1`（gitignored 临时文件，**UTF-8 BOM**）
- Modify: `D:\Claude Code+DeepSeekV4\memory\book-atlas-project-2026-09-20.md`
- Modify: `D:\Claude Code+DeepSeekV4\memory\MEMORY.md`

- [x] **Step 1: 重建发布包装脚本（带 BOM，中文消息不会被当 GBK）**

Run:
```powershell
$msg = @'
v0.72: 长列表展开/收起 —— 与谁有关 6 条 / 他的一生 8 条 / 本章新关系 10 条 / 初次登场 16 个，超出默认收起，可分批或全部展开，收起回到段首

- 超 40 条分批「再显示 20 条（n / total）」+「全部展开」；按钮带 aria-expanded/aria-controls；截断处底部渐隐
- 顺手修缓存事故：v0.69-v0.71 改了前端漏 bump CACHE（停在 v68）→ 老访客一直跑 v0.68 代码；
  本轮 bump 到 v72 触发 SW 重装修复；CHANGELOG 旧条目（未发布）标签同步改为（已上线）
'@
$ps1 = 'D:\Claude Code+DeepSeekV4\book-atlas\tools\_publish-now.ps1'
$body = '# v0.72 发布（临时文件，_publish-*.ps1 被 .gitignore 排除，不上传）' + "`r`n"
$body += '$Message = @''' + "`r`n"
$body += $msg + "`r`n"
$body += "'@" + "`r`n`r`n"
$body += '& "D:\Claude Code+DeepSeekV4\book-atlas\tools\push-via-api.ps1" -Message $Message' + "`r`n"
[IO.File]::WriteAllText($ps1, $body, (New-Object System.Text.UTF8Encoding $true))
Get-Content $ps1 -TotalCount 3
```
Expected: 前 3 行是注释行 + `$Message = @'` + 中文消息首行（**不乱码**；乱码即说明 BOM 没写上，重跑）。

- [x] **Step 2: 执行发布**

Run:
```powershell
& 'D:\Claude Code+DeepSeekV4\book-atlas\tools\_publish-now.ps1'
```
Expected: 退出码 0，输出含新的 commit sha / 成功提示；失败则读输出排错（绝不改用 git push）。

- [x] **Step 3: 线上复验（新标签页打开 live）**

1. `tools.browser.tabs.open({ url: 'https://wakennorman.github.io/book-atlas/' })` → 记 `liveTabID`
2. `tools.browser.evaluate`（缓存名；若返回 pending/未 resolve，隔几百毫秒再调一次直到拿到数组）:
```js
(async () => {
  const keys = await caches.keys();
  const shell = await caches.open('bookatlas-v72').then((c) => c.keys()).then((ks) => ks.map((r) => r.url.split('/').pop()));
  return { keys, hasApp72: shell.includes('app.js?v=72'), hasCss72: shell.includes('style.css?v=72') };
})()
```
Expected: `keys === ['bookatlas-v72']`（旧 v68 缓存已被 activate 删除）、`hasApp72 === true`、`hasCss72 === true`。
3. `tools.browser.evaluate`:
```js
(() => {
  window.__ba.selectCharacter('cao-cao');
  const s = document.querySelector('#panel [data-fold-key="rel:cao-cao"]');
  const fb = s && s.querySelector('.fold-body');
  return {
    foldAlive: !!s,
    visible: fb && [...fb.children].filter((c) => !c.hidden).length,
    n: s && +s.dataset.n,
    foot: s && s.querySelector('.fold-foot .fold-btn').textContent.trim(),
    epubStillThere: document.getElementById('export-btn') ? true : [...document.querySelectorAll('button')].some((b) => b.textContent.includes('EPUB')),
  };
})()
```
Expected: `foldAlive === true`、`visible === 6`、`n === 6`、`foot` 以 `再显示 20 条` 或 `⌄ 展开全部` 开头、`epubStillThere === true`（老功能回归）。
4. `tools.browser.console({ tabID: liveTabID, level: 'error' })` → Expected: `messages: []`。

- [x] **Step 4: memory 编年史追加**

Edit `D:\Claude Code+DeepSeekV4\memory\book-atlas-project-2026-09-20.md` —— 追加到文件末尾：

```markdown

## 2026-09-28 · v0.72 长列表展开/收起（+修 v0.69–71 漏 bump CACHE）

- 规格 `book-atlas/docs/superpowers/specs/2026-09-28-panel-fold-design.md`（方案 A：分段展开/收起，否掉"段内滚动"和"浮层"）
- 默认条数：与谁有关 6 / 他的一生 8 / 本章新关系 10 / 初次登场 16 / 关系卡·关系链·地点 10；本章事件（≤7）、关系内部事件行（中位 1）、重大事件轴（已有 46vh 内部滚动）**不折**
- 实现三件套（`js/app.js`，插在 `esc` 之后）：`foldVM`（算状态与按钮文案）→ `foldSection`（生成 HTML，**把超限条目烤上 `hidden`**）→ `applyFolds`（点击后原地切 hidden），外加 document 级 `[data-fold]` 委托（插在 `#path-go` 绑定前）
- **★ 关键约束：点击折叠绝不重渲染面板** —— 只切单段 `hidden`，否则 `#ai-answer`（AI 讲解结果）会被 innerHTML 冲掉；断言里用「AI 探针节点」盯住这一点
- 分批规则：总数 ≤40 一键「展开全部 N 条」；>40 「再显示 20 条（n / total）」+「全部展开」；全量后变「⌃ 收起」（段首、段尾各一个，段首只在展开态出现）；收起时 `scrollIntoView({block:'nearest'})` 回段首
- **★ 第四次缓存坑（最贵的一次）**：CHANGELOG 第 4 行规定「版本号＝`CACHE` 号」，但 v0.69（无障碍）、v0.70（键盘）、v0.71（EPUB）三轮改了 `index.html/app.js/style.css` **都没 bump**（CACHE 停在 v68）→ `sw.js` 字节没变 → 已装 SW 不重装 → **更早访问过的老访客一直跑 v0.68 代码**；新访客因首次安装 cache.addAll 拿到新文件，所以端到端复验看不出来。本轮 bump `bookatlas-v72`（index.html 两处 `?v=72` + sw CACHE + SHELL 两处）后 activate 删旧 cache 全量重装修复
- 顺手修：CHANGELOG 里 v0.61–v0.71 的`（未发布）`标签全陈旧 → `（已上线 · 2026-09-28）`（11 处 replaceAll）
- 验证：门禁五步本地全绿；浏览器断言（默认条数 / 分批 20 / 全部展开 / 收起回段首 / AI 探针存活 / 切人再回保持 / 换书清空 / 🔒 只读且锁的关系根本不在列表里 / 百年孤独地点 13→10）；截图（浅色/深色/字号 l 渐隐）；线上 `keys=['bookatlas-v72']` + 老功能回归 + console 0 错
- 工具限制记录：harness 浏览器**无视口缩放/设备模拟**，手机断点只能静态检查（`.fold` 规则不含视口单位），没有实测截图
**关联：** [[book-atlas-project-2026-09-20]]
```

- [x] **Step 5: MEMORY.md 索引行更新**

Edit `D:\Claude Code+DeepSeekV4\memory\MEMORY.md`：

oldString:
```
版本编年史 v0.19–v0.71（时间旅行/不剧透 AI/小程序/无障碍/EPUB 阅读伴侣）
```
newString:
```
版本编年史 v0.19–v0.72（时间旅行/不剧透 AI/小程序/无障碍/EPUB 阅读伴侣/长列表展开收起）· **发版必同步三处版本号（index.html ?v= / sw CACHE / sw SHELL——v0.69–71 漏 bump 导致老访客停旧码）**
```

- [x] **Step 6: 收尾**

Run:
```powershell
# 本地预览服务停掉
Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*python*' } | Stop-Process -Force
git -C "D:\Claude Code+DeepSeekV4\book-atlas" status --short | Select-Object -First 20
```
Expected: `git status` 只显示未跟踪/已改的工作文件（**不做本地 commit**；`_publish-*.ps1`、`(压缩*)*.md`、`_tmp-*` 应被 `.gitignore` 吞掉不出现）。
