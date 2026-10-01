# 更新日志（CHANGELOG）

节奏：**本地验证 → 发布门禁（`.github/workflows/check.yml`）→ 上线**。
版本号就是 `sw.js` 里的 `CACHE = 'bookatlas-vNN'`（改前端资源必须同步 `index.html` / `editor.html` 的 `?v=NN` 与 SW 预缓存清单）。

---

## v0.86 · 三类"只有真按快一点才会出现"的故障

先说**没做的**：v0.85 之前的性能优化已经到位，实测三国（871 人 / 2232 关系）每一次交互的完整代价是

| 操作 | 每次耗时 |
|---|---|
| applyFocus（聚焦 1 跳） | 19.45 ms |
| applyEdgeFilter（关系过滤） | 13.08 ms |
| applySizeFilter（人数过滤） | 6.02 ms |
| chart.clear()+setOption | 5.58 ms |
| chart.setOption 全量 | 5.01 ms |
| buildOption（每次交互都跑） | 1.65 ms |
| updateCountHint | 0.77 ms |

最贵的点击类操作（选人 / 点线）整条链路 ≈ 6.7 ms，60fps 的预算是 16.7 ms/帧，**余量约 2.5 倍，不构成瓶颈**。所以继续做 `buildOption` 增量更新，是拿可维护性去换一个已经不存在的性能问题 —— 不做。剩下的真实风险不在性能，在下面三处。

**① 快速切书会让后到的响应覆盖当前书（P0）**

`loadBook()` 有三处 `await`（取图包、`g.json()`、取整份兜底），但**没有任何过期响应守卫** —— 没有 `AbortController`，没有请求序号，await 之后也不复查当前选的是哪本书。

实测症状（`test/races.mjs` 会人为给三国图包加 800ms 延迟）：连点切换「百年孤独 → 三国 → 百年孤独」之后，

```
下拉框显示「one-hundred-years-of-solitude」时，state.book 是「three-kingdoms」（871 人）
```

更糟的是这条路径会走进 `initChart` → `dispose()`，把**刚建好的** chart 销毁，并连带解绑新 handler 的 `ResizeObserver` —— 表现是"图和下拉框对不上，而且切着切着窗口 resize 就失灵了"。

已加 `state.loadSeq` 请求序号，每个 await 之后复查，不是最后一次就直接丢弃。预取文案的时机也一并挪到所有 await 之后（原先在 `g.json()` 之后立刻发起，idle 回调可能在 `state.book` 提交前就跑，`attachText` 会拿旧书做校验而拒绝）。

**② 一本文案拉取失败，会让**下一本**的文案永久空白（P0）**

v0.85 的文案状态是一个全局 `state.textLoaded`，取值 `true / false / 'failed'`。而 **`'failed'` 是 truthy** —— 于是 `attachText` 开头的 `|| state.textLoaded` 会把它挡掉：第一本文案拉取失败后，第二本**无论网络是否正常**都再也贴不回文案，整本书的人物描述、结局、事件摘要全空，而且没有任何提示。用户只会看到一个"描述都是空的"应用。

失败分支还没有 slug 校验，书 A 的失败会写到当时已经是书 B 的状态上。

已改成**按书记**的 `state.textStatus = { slug, status }`，并把请求序号一起带上，"切走之前那次请求的结果"同样不会回头污染当前书。

**③ 文案没到就点「导出 JSON」，导出会永久毁掉散文（P0）**

`desc` / `fate` / `summary` / `quote` 和关系小事件的 `text` 全都来自文案包，是图渲染完之后**异步预取**进来的。图刚画出来的一两秒内点「导出 JSON」，拿到的是一份**所有文案都被剥掉**的 JSON。

而 README 正是让贡献者把这个文件放进 `data/` 再登记进 `books.json` 的 —— 于是这份残缺文件会被提交，`make-slim-packs.mjs` 再从它生成文案包，散文**永久没了**，而且 `check:packs` 还会"通过"，因为它比对的正是这份已被剥掉的源文件。

已加 `ensureTextForExport()`：导出前确认文案已就位，没就位就重新拉一次，拉不到就如实告知并**中止导出**，不产出残缺文件。

**④ 导一次图会把屏幕上的图注和节点大小带歪（P1）**

`exportPositions()` 为了算未 fit 过的坐标，会调 `buildGenerationPositions()` 再把 `pos` / `bands` 存回去。但 `buildGenerationPositions` 还会**重建** `bandLabels`（`new Map()` 一份新的）和按容器尺寸重算 `stepWorld` —— 这两个没存回去。后果是导一次 PNG/SVG/EPUB 之后：

- `bandLabels` 是按未 fit 过的 `bands` 坐标算的，而 `bands` 已经换回 fit 过的 ⇒ 屏幕上的「第 N 代 / 阵营」图注漂到别的列上；
- `stepWorld` 变了 ⇒ `buildOption` 算出的 `spacingScreen` 与 `state.pos` 实际适配出来的间距对不上，节点符号大小跟着变。

三个一起存回即可。

**⑤ 新增 `test/races.mjs`（8 断言）**

自带一个静态服务器来制造条件：给三国图包加 800ms 延迟、让除百年孤独外的文案包一律返回 500。四组断言分别守住上面 ①②③④ 与"连切两次书后 resize 回调仍有效"。已逐项验证**把修复退回就会失败**：

| 退回的修复 | 测试结果 |
|---|---|
| `loadSeq` 过期守卫 | exit 1（下拉框与 state.book 不一致那两条断言失败） |
| `textStatus` → 全局 `textLoaded` | exit 1（D 组断言失败，`status=null`） |
| `ensureTextForExport` | exit 1（E 组断言失败，导出未被拦下） |

门禁从 19 步变 20 步。

**⑥ 顺手删掉的死代码**：`textState()` 定义了但从未被调用。

---

## v0.85 · 修剧透泄漏 + 让门禁真的会拦

**① 剧透泄漏：两人关系 BFS 漏了 `relLocked`（P0）**

`js/app.js` 的 `bfs()` 查了 `relVisible`/`passEdgeFilter`/`relVisibleAt`，唯独漏了 `relLocked`——而 `state.adj` 收录**全部**关系、不过滤。实测「读到第 10 章、两端人物都能在输入框里选中、但关系本身还没成立」的边：

| 书 | 可被穿过的锁边 |
|---|---|
| 百年孤独 | 3 条（乌尔苏拉—美人儿蕾梅黛丝「曾祖孙」@14） |
| 罪与罚 | 5 条（拉斯柯尔尼科夫—阿芙朵嘉「兄妹」@21） |
| **三国** | **201 条**（陶谦—刘备「让位托付」@12、曹操—典韦「主从」@12…） |

这些边会被 BFS 走通，并在 `runPath` 里把 `rel.type` 原样印出来 —— 读者读到第 10 章就能看到第 12 章才发生的关系性质。`shared/graph-core.js` 本来就有这个判断，是三份手抄漂移出来的。已补上，并加了会失败的回归测试。

**② ESLint 门禁一直是"假绿"（P0）**

`package.json` 声明 `eslint@^9`，但仓库只有旧格式 `.eslintrc.json`（ESLint 9 已废弃）⇒ `npx eslint` 直接报 "couldn't find an eslint.config.(js|mjs|cjs) file" 退出 1；而 `check.yml` 那一步结尾是 `|| true`，把崩溃吞了。**结论：CI 里 ESLint 从来没检查过任何一行代码。**

已补 `eslint.config.js`（扁平配置）、删 `.eslintrc.json`、去掉 `|| true`。首次真跑暴露出 34 个历史 error，分三类处理：vendor 全局（`echarts`/`fflate`/`pdfjsLib`）声明进 config；`no-irregular-whitespace` 报的 U+3000 全角空格是中文文案里有意用的视觉分隔，规则关掉并写明原因；`<\/script>` 的 `no-useless-escape` **不是无用转义**——单文件导出把 app.js 原文内联进 HTML 的 `<script>` 块，字面量 `</script>` 会让浏览器提前截断脚本，用逐点 disable + 注释说明。

**③ EPUB 导出产出损坏文件（P0）**

`js/export.js:54` 把 `buildCompanionEpub()` 的**返回对象**（`{bytes, pages, chars…}`）直接塞进 `new Blob([epub])` ⇒ 用户拿到几十字节、内容为 `[object Object]` 的 `.epub`。同文件 `BA.toast` 在 `window.__ba` 里根本不存在。

根因是 `js/export.js` / `js/ai.js` 是 `app.js` 里同一套逻辑的第二份手抄。**已删除这两个文件**，`bindUI` 直接调用本文件的 `runExport`/`openAiModal`/`saveAiConfig` —— 少一次网络往返，少一份会漂移的副本。

**④ 版本号三处不一致 + 补上门禁（P0）**

改前端资源前是 `package.json=0.73` / `sw.js=v84` / `CHANGELOG=v0.72` 三个数。`bump-version.mjs` 不碰 `package.json` 和 CHANGELOG。新增 `scripts/check-version.mjs` 并进 CI，比对 5 处：sw.js 的 `bookatlas-vNN`、index/editor.html 与 js/editor.js 的所有 `?v=NN`、sw.js SHELL 清单里的 `?v=NN`、package.json 的小节。

这正是 CHANGELOG 里记过的 v0.69–v0.71 事故（连着三轮改前端漏 bump `CACHE`，老访客一直跑旧代码）—— 当时没有任何检查能发现。已验证：把 sw.js 改回 v84 会报 5 处不一致并 exit 1。

**⑤ `window.__BA_VERSION` 从未被赋值（P0，随 ③ 一起消失）**

全仓库零处写入 ⇒ 按需加载永远请求 `?v=1`，而 sw.js 预缓存的是 `?v=84`，两个永远命中不了的键。

**⑥ SW 预缓存去重 + 补三國**

`sw.js` 的 SHELL 里 `editor.html`/`css/editor.css`/`js/editor.js`/`css/style.css`/`js/app.js` 各存两份（一份无 `?v=`、一份带 `?v=NN`），Cache Storage key 不同 ⇒ app.js 白占两份 193KB。另外 `data/three-kingdoms.json` 唯独不在预缓存里，首次离线访问拿不到三国。两处都已修。

**⑦ 删掉空转的 CI 流水线**

`.github/workflows/build.yml` 每次 push 把 JS/CSS 压到 `dist/` 再提交回 main，但 `dist/` 下 0 个文件被跟踪、0 处被引用（页面加载的是未压缩的 `js/app.js?v=NN`），且它还引用着已删除的 `js/export.js`/`js/ai.js`。已删除该 workflow。

**验证**：冒烟 29 / 核心 **68**（原 51，新增 17 条剧透断言）/ E2E 17 全通过；ESLint exit 0；`validate --all`、`audit-search --all`、`check-packs-sync`、`miniprogram smoke` 全通过。剧透回归测试用旧版 `app.js` 跑会 exit 1、修复后 exit 0，确认它真的会拦。

### v0.85 附带：五项交互性能优化（都在热路径上）

**① `charLastCh` / `relCh` 预计算成 Map（悬停卡顿的主因）**

这两个函数随书确定、整个会话不变，却每次调用都全扫 `events` + `relations`（三国 ≈ 2900 次迭代）。而 `charLastCh` 被 tooltip 的 `formatter` 调用 ⇒ **鼠标划过节点就走一遍**；EPUB 导出调 871 次 ≈ 250 万次迭代。现在 `loadBook` 里一次算好存 Map，查不到则退回原算法。

三国（871 人 / 2232 关系）实测，各跑 20000 次：

| | 总耗时 | 每次 |
|---|---|---|
| `charLastCh` 全扫（旧） | 1731.3 ms | 86.6 µs |
| `charLastCh` 查表（新） | 1.0 ms | 0.05 µs |

**提速 1731×。** 悬停一帧从 86µs 降到 0.05µs。

**② `relaxPositions` 网格键改整数打包**

原来是 `` `${gx}:${gy}` ``，每节点每轮查 9 次 → 三国 ×140 轮 ≈ 110 万次模板字符串分配。改成 `(gx+OFF)*SPAN + (gy+OFF)`。已写等价性验证：采样 16 万个格子无碰撞、全部落在 `Number` 安全整数范围内、且 **200/871/50 三种规模下最终坐标与字符串版逐位一致**。

**③ `initChart` 的 ResizeObserver / resize 监听泄漏（v85）**

`chart.dispose()` 不解绑我们挂在 `window` 上的回调，而 `initChart` 每次换书、每次开关剧透保护都会重跑。**实测：连开关 3 次剧透保护就多挂 3 个 resize 监听** —— 切 5 次书后一次窗口 resize 会把「重排 + 全量 setOption」跑 5 遍。现在先 `teardownChartListeners()` 再挂新的，并给回调加重入守卫（`onResize` 里会写被观察元素的 `style.height`，本来就会多触发一轮）。

**④ `cssVar('--accent')` 提出逐节点循环**

`getComputedStyle()` 在样式脏时每次调用都强制同步重算样式，原来它在 `buildOption` 的逐节点 `.map()` 里 —— 三国开「提及」时一次 `buildOption` 要同步重算几百次。

**⑤ 右栏/时间轴按钮改 document 级委托**

面板内容是整体 `innerHTML` 重建的，而 `bindGoto` 每次重建都给每个元素挂一个新 listener：曹操这种 261 条关系的枢纽人物，一次点击几百个闭包；时间轴一次挂 702 个（事件数）。节点每次重渲染都被丢弃、listener 只增不减。现在统一走 `handlePanelClick` 委托（本文件已有 `data-fold`/`data-export` 等同类委托），并缓存 `.legend-item` / `.event-chip` 的 NodeList（原先每次高亮变化都遍历全部 702 个芯片改 class）。

### v0.85 第二轮：单文件导出的剧透泄漏 + 小程序分组漂移 + 三份实现对拍

**⑧ 单文件 HTML 导出无视剧透过滤（唯一还在漏的导出格式）**

`index.html:494` 写着「导出的内容跟随你当前的筛选：剧透进度、人数、次要人物、地点、聚焦都会生效」，但 `buildStandaloneHtml` 直接内联整个 `state.book` —— 于是**所有结局、所有还没发生的关系**都在里面，把文件发给别人后对方一搜就能看到。

新增 `standaloneBook()`：按「剧透进度 + 时间旅行」裁一份干净副本（人物、关系、关系小事件、事件、地点），并清掉被裁空的 `events` 数组（避免留下"这里曾经发生过什么"的结构线索）。人数/次要人物/地点/聚焦属于视图筛选，内联完整数据让对方能自己筛，反而更有用。

**⑨ 小程序的分组口径漂移（网页版修了、小程序没修）**

同一套判定逻辑在三处手抄：`js/app.js`、`miniprogram/utils/graph.js`、`shared/graph-core.js`。上一轮修「分组要按当前归属而不是最终归属」时**只改了 app.js** —— 三国 `groupMode=faction` 且 11 个人物有 `factionHistory`，于是小程序至今把「此刻还在群雄」的人画进「曹魏」组，图注与节点颜色也对不上。三份的 `maxChapter` 下限也不一致（app 用 0，另两份用 1；章号从 1 起，已统一为 1）。

三份都已修齐。

**⑩ 为什么不做「三份合一」，而是加对拍（架构决定）**

评估过让 `shared/graph-core.js` 成为唯一真源，两个硬阻塞：
- **单文件导出与 ESM 冲突**：`buildStandaloneHtml` 用正则匹配 `<script src="js/app.js?v=NN"></script>` 再把文件内联进一个 classic `<script>`。加 `type="module"` 后正则**静默匹配失败**（导出出的 HTML 指向一个不存在的文件，且不报错），而且顶层 `import` 在 classic script 里是硬 SyntaxError。
- **小程序物理上无法 import `shared/`**：`project.config.json` 的 `miniprogramRoot` 就是 `./`，没有 `packOptions`/`subpackages`；且 `miniprogram/package.json` 是 `"type": "commonjs"`，加 `import` 会直接挂 `node --check`。

加上 graph-core 缺 `eventVisibleAt` 等 app 专用语义、且会丢掉 app.js 的记忆化（那是 v0.68 性能修复的一部分）。**结论：保持三份，改用对拍守住漂移。**

**新增 `test/parity.mjs`（已进 CI，54 项断言）**

在真实浏览器里取 `window.__ba._predicates()`（为此新增的纯函数谓词集合，无副作用），与 `shared/graph-core.js`、小程序那份在三本书 × 9 种状态（全解锁 / 剧透 5/10/30 / 只亲缘 / 只虚线 / 关族谱 / 时间旅行 8 / 剧透+时间旅行）下逐人物、逐关系对拍 `charCh`/`charLocked`/`relLocked`/`relVisibleAt`/`passEdgeFilter`/`groupKeyOf`/`groupLabelOf`/`charLastCh`/`periodText` 等 22 个函数。

已验证它真的能拦：把小程序那份还原成有 bug 的版本，测试立刻报出 `剧透=5: 11 处不同（首例 贾诩 mini=[fwei/曹魏] core=[fqunxiong/群雄]）`。

### v0.85 第三轮：聚焦功能漏检「族谱补全」开关

**⑪ 关掉「族谱补全」再聚焦，会出现大批没有连线的悬空节点**

`focusSet()` 逐跳扩展时只查了 `relLocked` 与 `relVisibleAt`，**漏了 `relVisible`** —— 而 `relVisible` 正是"族谱补全"开关的实现。结果：关掉族谱补全后聚焦某人时，只能通过**推导边**（`derived: true`，原文没有直接互动）连到的人仍会被算进聚焦集合并被画出来，但那些边在图上并不画（`buildOption` 过滤掉了）⇒ 一堆悬空节点。

实测三国（全部 871 个角色的各档聚焦组合下累计）：**50999 个悬空节点**。聚焦刘备 2 跳时，仅推导边就能多连出 100 人。小程序那份 `miniprogram/utils/graph.js:166` 本来就有这个判断，是网页版缺的。

已补上。同时发现并修了一个连带的缓存 bug：`focusCache` 的键只有 `id|depth`，不含 `showDerived` —— 它现在参与集合计算了，但切换开关不会清缓存，于是聚焦中切换会继续用旧集合。缓存键已改为 `id|depth|showDerived`。

`shared/graph-core.js` 原本**根本没有 `focusSet`**，等于三份里少一份、没法对拍，已补齐（口径与另两份一致）。

**对拍测试扩到 72 项（+18 聚焦断言）**：三本书各取关系最多的人（曹操 / 拉斯柯尔尼科夫 / 奥雷里亚诺·布恩迪亚），对 1/2/3 跳 × 开/关族谱补全共 6 种组合，三份的聚焦集合逐一比对。已验证：把 `relVisible` 那行退回，测试立刻 exit 1。

**清理 `docs/`**

删掉 4 个设计探索稿（`ui-mockup*.html`，用各自的假数据、与最终上线的 `css/style.css` 已有出入、零引用），连同为它们建的索引文件。保留 `desktop-preview.html` / `mobile-preview.html` —— 这两个不是设计稿，而是把**真页面**按固定宽度摆进设备外框的响应式预览壳，已在 README「本地跑」一节写明用法。

### v0.85 第四轮：编辑器测试 + 数据拆包（首屏快 3 倍）

**⑫ 编辑器逻辑测试 `test/editor.mjs`（已进 CI，69 项）**

`js/editor.js` 有 1700 行，此前只有 `node --check`。里面最容易坏、又最难手测的是纯逻辑：
- `parseLooseJson` —— 修模型返回的坏 JSON。**整本 AI 生成的成败全押在这一个函数上**，坏了的表现是"某一章老是失败"，不报任何明显错误。
- `hanToNum` / `headingNo` / `splitChapters` —— 从书里切章节。汉字数字转不对，整本书就只会当成一整段。
- `cleanHtml` / `normalize` / `guessKin` / `mergeDraft` —— EPUB 转文本、补字段、猜亲属、合并去重。

为此给 `window.__ed` 增加了纯函数出口（无副作用）。新测试顺带发现并修了一个真 bug ↓

**⑬ 修复：被 max_tokens 截断的 JSON 完全无法恢复（整本生成的常见失败）**

`parseLooseJson` 原来只在"**末尾还有若干个括号合上了**"时才做修复（沿 marks 数组往前退一格再补齐）。但 max_tokens 拦腰截断时正文末尾往往**一个括号都没合上** —— marks 为空，修复循环一次都跑不到，直接抛错。而这恰恰是最常见的截断形态。现在新增一条分支：扫描结束时若仍有未闭合的括号且不在字符串中间，直接补齐再试一次。

已验证：把这条分支退回，测试 exit 1；恢复后 exit 0。

**⑭ 数据拆包：首屏只下图包，文案后台预取**

原来一份 `data/<slug>.json` 同时装着"画图要的"和"读了才知道的"。实测 gzip 后：

| 书 | 现在 | 首屏（图包） | 文案（后台） | 首屏省 |
|---|---|---|---|---|
| 百年孤独 | 24.5 KB | 7.6 KB | 16.3 KB | **69%** |
| 罪与罚 | 10.6 KB | 4.6 KB | 6.4 KB | **57%** |
| 三国演义 | 230.4 KB | 78.9 KB | 138.7 KB | **66%** |

- 新增 `scripts/make-slim-packs.mjs` 从整本生成 `<slug>.graph.json` + `<slug>.text.json`；`books.json` 增加 `graphFile` / `textFile`。
- **刻意不在点开人物时才去拉文案**（那会让第一次点击的面板先空一下）。文案在**图渲染完、浏览器空闲时预取**，用户点开时通常已就绪。实测首屏 chart 从 1118ms → 267ms。
- 字段划分严格按代码实际读的来，不能凭感觉砍：
  - 人物留 `firstCh`（剧透锁定）、`aliases`（搜索）、`factionHistory`（分组与阵营色）、`tier`（折叠）
  - **关系的 `events[].chapter` 必须留** —— `relCh()` 靠它算"这段关系第几章成立"，`charLastCh()` 也靠它算人物最后出场章
  - **事件的 `chars` 必须留** —— `charLastCh()` 靠它判断结局能不能剧透
- 拿不到 `graphFile`（老缓存 / 没部署）自动退回整份，功能不受影响。
- `sw.js` 预缓存改成图包；**文案包刻意不预缓存** —— 预缓存会在首次访问就下载，等于把省下的又还回去。
- `scripts/make-slim-packs.mjs --check` 进 CI：既校验同步，也校验「两份合起来 == 源文件」，剧透判定依赖的字段少一个就失败。
- 顺带修了 `validate.mjs` / `audit-search.mjs` 扫 `data/*.json` 时把生成物也当整本校验的问题（改为以 `books.json` 为准）。

**⑮ 停止跟踪 `.opencode/`**

172 个文件、4.06 MB 的第三方 agent skill 资料，与本项目零关系。已加进 `.gitignore` 并 `git rm -r --cached`（只从索引移除，磁盘文件保留）。

### v0.85 第五轮：计数口径守卫 + 小程序分包余量告警

**⑯ 计数提示与 aria 文案的一致性守卫（测试 +3 项）**

`updateCountHint()` 与 `graphAriaLabel()` 各自独立全扫一遍人物和关系算"显示多少"，两边口径很容易漂（而且漂了不会有任何报错，只是屏幕上一处写着 326 人、读屏里念 328 人）。现在 `window.__ba` 暴露 `countHint()`，浏览器测试在默认 / 剧透=10 / 时间旅行@5 三种状态下断言两处人数必须一致。

**⑰ 小程序主包余量变成硬失败（原本只是一句提示）**

`make-miniprogram-packs.mjs` 以前只 print 一句「数据按分包/按需加载（单包上限 2MB）」—— 但**分包根本没实现**：`miniprogram/app.json` 没有 `subpackages`、`project.config.json` 没有 `packOptions`，所有数据包都在主包里。实测余量 951 KB，而三国规模的一本约需 1000 KB —— **下一本书就会超限，而且要等到"上传小程序"那一刻才失败**。

现在脚本会算出余量，够再放一本就报「够再放 N 本」，不够就直接 exit 1 并说清楚必须先分包。本脚本不做自动分包，只负责把这个问题提前暴露在本地。

**门禁现状（17 步全绿）**

```
smoke 29 · core 68 · e2e 17 · browser 20 · editor 69 · parity 72
+ ESLint / 版本号 / check:packs / validate / audit-search / packs-sync / 小程序冒烟
```

**新增浏览器行为测试 `test/browser.mjs`（已进 CI）**

用无头 Edge 真加载页面并点一遍，10 项断言：四类委托按钮（`data-goto` / `data-event` / `data-place-filter` / `data-focus-rel`）实际生效、resize 监听无累积、两个预计算 Map 与原算法逐条一致、控制台无报错。这类"委托写错了但不抛错、只是点不动"的问题 node 冒烟测不出来。脚本找不到 Edge/Chrome 会自行跳过，不阻塞其它检查。已验证：旧版 `app.js` 跑会测出累积 3 个监听并失败。

---

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

- 导出面板新增第 ⑤ 项：**关系总图 + 人物志 + 事件轴**打包成 EPUB 2.0（`mimetype` 第一个且不压缩 + OPF + NCX），可传进微信读书与原著并排读
- **跟随当前剧透进度**（锁着的人与事件不写进去）：百年孤独 49 人/513KB → 读到第 6 章 23 人/309KB
- 图谱用 JPEG 内嵌（三国 472KB / 2000×380）
- 修：`strToU8(atob())` 按 UTF-8 编码二进制会坏图（PNG 魔数 `c289…`）；导出坐标要除以 `fitLast` 还原世界尺度（否则大书的图糊成一团）
- 验证：ZIP 头 / JPEG 魔数 / OPF，以及用项目自己的 `scripts/extract-epub.mjs` 回读（5 个文档、46.5 万字全命中）

## v0.70（已上线 · 2026-09-28）· 键盘与读屏

- 图容器 `tabindex="0" role="img"` + **动态 aria-label**（人数 / 时间旅行 / 剧透进度 / 当前选中）；`aria-live` 播报「谁、几条关系、第几章出场」
- **方向键在人物间移动**（几何：最正对该方向、最近）、回车看档案、Esc 取消、点图自动聚焦；视图跟着光标走
- 冲突解法：图聚焦时方向键归图，**否则仍是翻章**（实测两不误）

## v0.69（已上线 · 2026-09-28）· 无障碍

- 「♿ 显示」：**色盲友好配色**（Okabe–Ito 八色按阵营顺序分配）+ **字号**（小/中/大）
- 颜色收敛到单一出口 ⇒ 图、图例、打印版 SVG、分享图、人物卡全部跟随
- 设置存本机；小程序同一套（冒烟测试 52 项）

## v0.68（已上线 · 2026-09-28）· 工程优化

- **首屏 2905ms → 443ms（6.5×，同机同浏览器前后实测）**：CPU profiler 定位到 `symbolSize()` 被松弛算法每对调用（1061ms）+ 松弛自身 O(n²)（999ms）；改成网格邻域 + 数组局部运算 + 尺寸缓存（网格只跳过"不可能重叠"的对，布局等价）
  - 绝对值随环境浮动 ±2×：今天复测同机**复访 488–502ms**、**标签首次打开约 1.1s**（JIT 未热身）、线上含 1.4MB 数据下载冷启动 1.5s
- 新增 `window.__baPerf`（fetchParse / chart / total）便于自查
- **发布门禁**：GitHub Actions 跑语法 / `validate --all` / `audit-search --all` / 小程序数据包同步 / 小程序冒烟
- `meta.schemaVersion = 2` + 校验器检查
- 小程序「两人关系」改成**可搜索选择面板**（871 人不用滚轮）

## v0.67（已上线 · 2026-09-28）· 小程序分享卡片

- 「🖼 分享图」：1200×900 卡片（标题/统计/关系图/图例）→ 保存相册 / 发送给好友；转发与朋友圈也带它
- 卡片会**自动挑"铺得开"的布局**、标签按密度定字号并在上/右/左找空位（三国 326 人放下 131 个名字）
- 修：力导向坐标 NaN（缺温度限幅）；适配要用"可见节点"而不是全部坐标

## v0.66（已上线 · 2026-09-28）· 小程序补全

- 搜索（字号/别名/别的译名，自动展开折叠层，未来人物被剧透保护挡住）
- 两人关系（本地 BFS + 图上高亮整条链）、关系过滤（亲缘 5 类 × 线条 3 类 + 预设）

## v0.65（已上线 · 2026-09-28）· 微信小程序

- 个人主体不能用 web-view ⇒ 渲染层重写；不引 ECharts（1MB+）⇒ 自绘 canvas（~7KB）
- 数据打包进主包（1.16MB < 2MB），零网络请求；坐标构建时算好（分组布局确定性 + Node 里跑力导向）
- 逻辑与绘制是**纯函数** ⇒ 能在浏览器看图、能用 `node miniprogram/test/smoke.mjs` 在无开发者工具时跑通页面

## v0.64（已上线 · 2026-09-28）· 外部深链 + OG 分享图

- 书名旁给「微信读书 / 豆瓣 / 维基百科」链接（配在 `data/books.json` 的 `links`）
- `assets/og-cover.jpg`（1200×630，63KB）+ 9 个 `og:*` meta；页面标题跟着书变

## v0.63（已上线 · 2026-09-28）· 数据体检面板

- 编辑器「🩺 体检」：结构 / 引用 / 亲属 / 别名 / 时间区间一次过，每条可「去改」跳到那一条；复制报告；一键补齐译名变体；贡献三步清单
- 实测：三国 0 错误 / 29 警告 / 7 提示；百年孤独 0/0/1

## v0.62（已上线 · 2026-09-28）· AI 讲解（不剧透）

- 关系链 / 人物面板「🤖 讲一遍」：**资料先在本地按进度过滤**（结局不发）**再交给模型**，提示词钉死"只讲第 N 章之前"
- 用本地假 LLM 回显提示词做断言：最大章号 ≤ 进度、锁定结局不出现、时间旅行时上限跟着变

## v0.61（已上线 · 2026-09-28）· 时间旅行 + 阶段关系

- 「🕰 时间旅行」滑块：把图谱拨回第 N 章，只画当时已发生的关系；不动真实阅读进度（保护开着时最多拨到"读到的那一章"）
- `relations[].fromCh/toCh`：三国 **885 条**标了区间（552 条有结束章）。曹操↔袁绍：同盟(第3–6章)→盟友分歧→貌合神离(第18–31章)→敌对(第31章)→旧交；刘备↔孙权：姻亲(第54章起)→索还荆州(第65章)→敌对(第83章起)
- 修：平行边会点错关系（改成按"边上写的类型 + 当前可见"匹配）；平行边叠成一条线（按序号扇开曲率）

---

## 更早（摘要）

- **v0.59**：章节视图（第 N 章的世界：初次登场/新关系/事件/地点 + 下一章预告 + 一键推进进度）+ 导出四件套（单文件 HTML / 分享图 PNG / 打印版 SVG / JSON）
- **v0.58 及以前**：图谱（力导向 + 代际/阵营分组）、两人关系 BFS、剧透保护（按章锁定）、地点维度、大书三板斧（次要人物收起 / 人数过滤 / 1–2 跳聚焦 / 无限画布 + 标签分级）、族谱推导与亲属规范（kin 七类）、别名与译名搜索、本地编辑器（含整本 AI 生成流水线）、PWA 离线、三本书的数据（百年孤独 49 人 / 罪与罚 24 人 / 三国演义 871 人）
