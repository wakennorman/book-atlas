# 右栏长列表「展开 / 收起」设计

- 日期：2026-09-28 ｜ 版本：将随 **v0.72** 上线（`CACHE = 'bookatlas-v72'`）
- 状态：设计已获确认（方案 A）
- 范围：**仅网页端**（`index.html` / `js/app.js` / `css/style.css`）；小程序、时间轴、帮助与导出浮层不动

## 1. 问题与证据

用户反馈：右侧「他的一生」「与谁相关·凭什么事件」「本章新关系」等段落条目太多，看完要滑很久；`🤝 本章新关系（29）` 里的「…还有 17 条」只是文本、点不动。

实测（`data/*.json`，2026-09-28 统计）：

| 段 | 现状 | 三国实测 |
|---|---|---|
| 人物档案 › 与谁有关·凭什么事件 | **完全不截断** | 曹操 **261** 条 / 刘备 218 / 中位 2 |
| 人物档案 › 他的一生 | 硬截 40，「…还有」不可点 | 刘备 **207** / 曹操 196，中位 1 |
| 章节 › 本章新关系 | 截 12，「…还有 N 条」不可点 | 单章最多 **29** 条 |
| 章节 › 初次登场 chips | 全铺 | 单章最多 **39** 个 |
| 章节 › 本章事件 | 不截 | 单章最多 **7**（不需改） |
| 关系卡 / 两人关系链 / 地点面板 | 不截 | 地点最多 13；单关系事件行中位 1、仅 14/2318 超 6（不需改） |
| 重大事件轴 | 已有 `max-height:46vh; overflow:auto` 内部滚动 ✓ | 保持不变 |

右侧栏固定 **380px** 宽（`grid-template-columns: minmax(0,1fr) 380px`）。

## 2. 选型

| 方案 | 结论 |
|---|---|
| **A. 分段展开/收起 + 渐隐 + 超长分批** | ✅ **采用**：业界主流 progressive disclosure，直接对应「不要滑太久」，展开后内容仍在原位（不打断阅读层级） |
| B. 段内固定高度 + 内部滚动 | ✗ 右栏嵌套滚动条、滚轮易「卡」在段内；本质仍是滑很久，只是把滑动关进小框 |
| C. 「查看全部」开浮层 | ✗ 多一层 UI、多一次点击；与「点节点看档案」层级叠加。浮层内搜索可作为后续增强（本轮 YAGNI） |

## 3. 交互规范

### 3.1 组件结构

```html
<section class="fold" data-fold-key="rel:cao-cao">
  <!-- 展开态才出现的段首「收起」 -->
  <div class="fold-head" hidden>
    <button class="fold-btn" type="button" data-fold="rel:cao-cao" data-fold-act="collapse"
            aria-expanded="true" aria-controls="fold-rel-cao-cao">⌃ 收起</button>
  </div>
  <div class="fold-body" id="fold-rel-cao-cao">
    <li class="fold-item">…第 1 条…</li>
    <li class="fold-item fold-more">…第 7 条起（收起时隐藏）…</li>
  </div>
  <div class="fold-foot">
    <button class="fold-btn" type="button" data-fold="rel:cao-cao" data-fold-act="more"
            aria-expanded="false" aria-controls="fold-rel-cao-cao">再显示 20 条（6 / 261）</button>
    <button class="fold-btn fold-btn-alt" type="button" data-fold="rel:cao-cao" data-fold-act="all">全部展开</button>
  </div>
</section>
```

**按钮文案随状态变化**（`与谁有关`，N=6，曹操 261 条为例）：

| 状态 | 段尾按钮 |
|---|---|
| 收起，总数 ≤ 40 | `⌄ 展开全部 {total} 条`（一步到全量） |
| 收起，总数 > 40 | `再显示 20 条（{shown} / {total}）` + `全部展开`（并列两个） |
| 展开中（未到全量） | 同上（`shown` 递增） |
| 全量展开 | `⌃ 收起` |

- 总数 ≤ 默认 N 时，**不渲染 fold 结构**（无可折叠内容）
- `aria-controls` 的 id 由 key 派生并做 CSS 安全化（`:` → `-`）
- **段尾与段首按钮的 `aria-expanded` 同值**：`shown > N` 时为 `true`，否则 `false`
- 单位（条 / 个）由各段调用时传入：关系与事件用「条」，chips 用「个」

### 3.2 状态

- `state.fold = { [key]: shownCount }`；**缺省 = 默认 N（收起）**，收起即删除该 key
- key 按「段类型 + 上下文」：`rel:<人物id>`、`life:<人物id>`、`chrels:<章号>`、`newchars:<章号>`、`relev:<a>|<b>`（关系卡）、`path:<a>|<b>`（关系链）、`place:<地点id>`
- 切换人物/章节互不干扰；**换书（`loadBook`）时清空 `state.fold`**
- 面板重渲染（点事件、切筛选）后按 `state.fold` 恢复展开状态

### 3.3 按钮行为

- **收起时**：把该段标题滚进视口（`scrollIntoView({block:'nearest'})`），避免用户停在页面底部失去上下文
- 分批步长 20；`全部展开` 一步到全量
- 点击不重渲染面板（见 3.5），焦点留在被点按钮上

### 3.4 渐隐遮罩

截断时（`shown < total`）给 `.fold-body` 加底部渐隐（`mask-image: linear-gradient(...)`，同时写 `-webkit-mask-image` 兼容旧 Safari），颜色走主题变量（`--panel`），深浅色与字号三档都成立；展开到全量时移除。

### 3.5 渲染方式（关键实现约束）

- **DOM 全量渲染**（与现状一致，261 条本来就是全渲染），超出默认 N 的条目加 `fold-more` 类并按 `state.fold` 设 `hidden`
- 点击展开/收起 = **原地切换 `hidden` + 改按钮文案**，不重渲染整个面板 →
  不丢滚动位置、不丢面板里其它状态（**尤其是 AI 讲解结果 `#ai-answer`**，重渲染会把它清掉）
- 面板因其它原因重渲染时，按 `state.fold` 重新决定每条的 `hidden`

## 4. 各段默认条数

| 段 | N | 依据 |
|---|---|---|
| 与谁有关·凭什么事件 | **6** | 单条含 1 行关系头 + 2~4 行事件，6 条 ≈ 半屏 |
| 他的一生 | **8** | 单条含章标签 + 摘要 + 引文，8 条 ≈ 半屏（现为 40） |
| 本章新关系 | **10** | 单行条目；单章最多 29 |
| 初次登场 chips | **16** | 约 3 行 chip（单章最多 39） |
| 关系卡事件 / 关系链跳数 / 地点事件 | **10** | 兜底，一般不触发 |
| 本章事件、关系内部事件行、时间轴 | **不折** | 实测量小（≤7 / 中位 1 / 已有内部滚动） |

## 5. 可访问性

- 按钮为原生 `<button>`，带 `aria-expanded` 与 `aria-controls`；文案含数量与方向符（`⌄ 展开全部 261 条` / `⌃ 收起`）
- 展开/收起后焦点留在被点击按钮上（按钮始终在 DOM 中，读屏不丢位）
- **`🔒 还有 N 条…在你读到的进度之后` 保持只读文本**——展开不得绕过剧透保护
- 字号三档（s/m/l）只改字号不改 N，条数不足时由渐隐与按钮兜底

## 6. 代码落点

| 文件 | 改动 |
|---|---|
| `js/app.js` | 新增 `foldHtml(key, opts)` 生成器 + `updateFold(root, key, shown)`；document 级事件委托处理 `[data-fold]`（沿用现有 `closest('[data-*]')` 模式）；改 `renderCharacterPanel`（2 段）、`renderChapter`（2 段）、`renderRelationPanel`、`runPath`、`renderPlacePanel`；`loadBook` 清空 `state.fold` |
| `css/style.css` | `.fold` / `.fold-head` / `.fold-body` / `.fold-foot` / `.fold-btn`、`.fold-more` 隐藏规则、渐隐遮罩 |
| `index.html` | 两处 `?v=68` → **`?v=72`**（第 23 行 style.css、第 521 行 app.js） |
| `sw.js` | `CACHE = 'bookatlas-v72'`；SHELL 中 `./css/style.css?v=68`、`./js/app.js?v=68` → **`?v=72`** |
| `README.md` | 功能表「**人物志 · 人物卡**」行补一句：列表过长默认收起、可「展开/收起」 |
| `CHANGELOG.md` | 新增 **v0.72** 段（问题 → 改法 → 各段默认条数表 → 验证）；顺手把 v0.59–v0.71 的 `（未发布）` 标签改成 `（已上线 · 2026-09-28）`（实测均已在线上，标签已陈旧） |

**版本对齐说明（本轮必须 bump 的额外理由）**：CHANGELOG 第 4 行规定「版本号就是 `CACHE = 'bookatlas-vNN'`」，但 v0.69–v0.71 三轮改了前端**漏 bump**（CACHE 仍为 v68）。`sw.js` 字节未变 → 已装 SW 不会重装 → **更早访问过的访客至今可能仍跑 v0.68 代码**（无色盲配色/键盘导航/EPUB）。本轮 bump 到 v72 会触发 SW 更新重装，一并修复。

不改：`editor.html` / `js/editor.js`（编辑器 `?v=30` 不动）、`miniprogram/**`、`data/**`、`.github/**`。

## 7. 验证计划

1. `node --check js/app.js`；门禁五步（语法 / `validate --all` / `audit-search --all` / 小程序数据包同步 `check-packs-sync` / 小程序冒烟）
2. 本地 `python -m http.server 8765` → 浏览器断言：
   - 三国选曹操：`与谁有关` 默认 6 条且第 7 条起 `hidden`；点 `全部展开` → 261 条全可见且 `aria-expanded=true`；点一次 `再显示 20 条` → 显示 26 条（步长 20 ✓）
   - `他的一生` 默认 8 条；>40 时分批按钮文案/步长正确；`全部展开` 到全量后按钮变 `⌃ 收起`
   - 章节切到新关系最多的那章（29 条）：默认 10 条，原「…还有 N 条」位置已是**可点按钮**
   - 收起后段标题滚入视口；展开 AI 讲解后再展开/收起列表，**AI 结果不被清掉**；切人物再切回来展开状态保持；换书后重置
   - 剧透保护开启时 `🔒` 提示仍为只读
   - 桌面（≥1200px）与手机断点（<900px，右栏全宽）各看一眼
3. 颜色三档 + 字号三档下渐隐遮罩不糊字（截图核对）
4. 发布后线上复验：`sw` 名已变 `bookatlas-v72`、老功能回归（EPUB/色盲/键盘各点一次）

## 8. 风险与边界

- **DOM 量**：曹操 261 条全展开 ≈ 900 行 DOM，一次性渲染可接受（现网本来就是全渲染）；分批只是显示控制
- **性能**：fold 只影响 innerHTML 字符串拼接与 `hidden` 切换，不触碰图渲染热路径（v0.68 优化的 `symbolSize`/松弛不受影响）
- **回滚**：改动集中在 `js/app.js` 与 `css/style.css`（外加版本号），回退即恢复原状
