# 书脉 BookAtlas

> 把一本书的**人物关系**、**定义关系的小事件**和**标志性事件**放在一张图上：关系网络 + 重大事件轴 + 「两人关系」最短链 + **剧透保护**；自带**本地编辑器**和**整本生成**流程。
>
> 在线地址：**https://wakennorman.github.io/book-atlas/**
> 代码 MIT · 数据 CC BY-SA 4.0

![总览](docs/img/overview.svg)

---

## 能做什么

| 功能 | 说明 |
|---|---|
| **关系网络** | 力导向图；节点按阵营着色、**大小＝关系条数**、**形状＝性别**（● 男 / ▢ 女）；点节点看档案，点连线看关系与依据小事件 |
| **重大事件轴** | 按阶段分组（如"内战二十年"），点事件高亮相关人物；未读事件显示为 🔒 |
| **两人关系** | 本地 **BFS 最短路**，每一跳列出关系类型与依据事件（不依赖 AI、不联网） |
| **三种布局** | 自由 / 代际·横（按代分列）/ 代际·纵（按代分行）；图注有专属边距，跟随缩放但不压节点 |
| **剧透保护** | 按**章节进度**锁定：未读人物=灰色 🔒 且不画关系；未读事件=「🔒 第 N 章的事件」；关系里的小事件、人物结局也按章过滤 |
| **杂项** | 搜索（支持别名，如"上校""索尼娅"）、「定位这条线」、复位视图（双击空白）、深浅色、PWA 离线 |
| **本地编辑器** | 新建/导入、六个版块增删改、撤销重做（Ctrl+Z / Ctrl+Y）、本地校验、导出 JSON |
| **整本生成** | 上传整本书 → 自动分章 → 逐章 AI 草稿（人物 id 沿用名单）→ 一键合并去重 |

**已收录**

| 书 | 人物 | 关系 | 事件 | 剧透尺度 |
|---|---|---|---|---|
| 《百年孤独》（范晔 译） | 39 | 96 | 31 | 第 1–20 章 |
| 《罪与罚》（汝龙 译） | 24 | 30 | 21 | 41 个顺序章（6 部 + 尾声） |

![三种布局](docs/img/views.svg)

---

## 快速开始

### 只想看
打开 **https://wakennorman.github.io/book-atlas/** 即可；手机可「添加到主屏幕」离线看。

### 本地跑（不需要联网、不需要 GitHub）
```text
双击  本地预览.bat          # 需要本机有 Python，会自动起服务并打开浏览器
或手动：python -m http.server 8765   # 然后访问 http://localhost:8765/
```
> 直接双击 `index.html` 打不开是正常的：浏览器不允许 `file://` 页面读取数据文件，必须有本地服务。

### 打开编辑器
图谱右上角「✏️ 编辑」，或直接访问 `/editor.html`。

---

## 生成一本新书（AI 草稿 → 人工校对）

![editor-flow](docs/img/editor-flow.svg)

1. 「新建空白」或「载入」一本现有书（也可以在现有书上改）
2. 进「**整本生成**」，填 API 地址 / Key / 模型（**Key 只存本机浏览器**，不会上传别处）
3. 上传图书文件：支持 **txt / md / html / epub**（epub 在浏览器内解压解析，不需要联网；**PDF 请先转成 txt/epub**，Calibre 最省事）——传完会**自动分章**
4. 勾选章节 →「② 逐章生成」（一章约 1–2 分钟，可随时停止）
5. 「③ 合并去重」：人物按 **id 或姓名**合并、关系按 `from|to|类型` 合并并去重小事件、事件按 id 去重
6. 到各版块**逐条校对**（重点：同名人物、关系方向、事件章节），「本地校验」查一遍
7. 「导出 JSON」→ 放进 `data/`，在 `data/books.json` 登记一行 → 提交（也可以只用「预览」在本机看效果）

> 不用 AI 也完全可以：「新建空白」手填人物 / 关系 / 事件，跟做思维导图一样。

---

## 数据规范

```jsonc
{
  "meta":       { "slug": "", "title": "", "author": "", "chapters": 20, "note": "", "license": "CC BY-SA 4.0", "sources": [] },
  "factions":   [{ "key": "", "name": "", "color": "#hex" }],
  "characters": [{ "id": "pinyin-kebab", "name": "", "aliases": [], "generation": 1, "gender": "m|f",
                   "firstCh": 1, "faction": "", "title": "", "desc": "", "fate": "", "note": "" }],
  "relations":  [{ "from": "id", "to": "id", "type": "", "style": "solid|dashed|dotted",
                   "events": [{ "text": "定义这段关系的小事件", "chapter": "第X章" }] }],
  "phases":     [{ "id": "p1", "name": "", "order": 1 }],
  "events":     [{ "id": "e1", "phase": "p1", "order": 1, "ch": 1, "name": "", "chars": ["id"],
                   "summary": "", "impact": "", "quote": "" }]
}
```

要点：
- `style`：`solid`＝亲缘/同盟；`dashed`＝对立/伤害；`dotted`＝情人/过去/间接
- **没有明确年份的书不要编年份**，用 `phase + order` 排序
- `relations[].events` 优先收录"看着不起眼、却定义了两人关系"的小事件
- 不是家族史的书：`generation` 当作"人物分组"，并在 `meta.note` 里说明

### 文案写作规范（`validate.mjs` 会自动检查）

1. **先写全名**，外号/称呼写进括号：`何塞·阿尔卡蒂奥（第二代，绰号「巨人」）`
2. **一句一个主语**，不用「他／她」跨句指代不同人
3. **亲属称谓必须配人名**：写"父亲何塞·阿尔卡蒂奥"，不要只写"父亲"
4. 关系文案出现的人必须与 `relations[].from/to` 一致；事件文案提到的人必须出现在 `events[].chars`
5. 事件文案要能**脱离上下文读懂**（谁 · 对谁 · 做了什么 · 后果）

### 剧透保护（书里带这三个字段就能用）

- `meta.chapters`（总章数）、`characters[].firstCh`（首次出场章）、`events[].ch`（发生章）
- 关系/小事件的解锁章号 = 该关系 `events[].chapter` 里的**最小章号**；人物「结局」按**最后出场章**（出场章 + 相关事件章的最大值）判断
- 首发进入会**强制二选一**：不介意剧透（全部解锁）/ 我在读（选读到第几章）；右上角随时可改，进度按书存在本机

---

## 脚本

> 需要 Node 18+；本机 Node 不在 PATH 时，用绝对路径，例如
> `& "C:\Users\chw\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate.mjs`

| 脚本 | 用途 |
|---|---|
| `scripts/validate.mjs` | 数据校验 + 文案规范检查 + `gender/firstCh/ch` 检查。`node scripts/validate.mjs --all` 一把过 |
| `scripts/draft.mjs` | 命令行版 AI 草稿：`node scripts/draft.mjs --title "书名" [--text book.txt]` |
| `scripts/extract-epub.mjs` | 零依赖 EPUB 抽文（本地校对用）：`node scripts/extract-epub.mjs book.epub out.txt [--split 目录]` |
| `tools/push-via-api.ps1` | GitHub API 发布（本机 `git push` 被墙时用），同时开/查 Pages |

---

## 目录结构

```
book-atlas/
├── index.html / css/style.css / js/app.js      # 图谱应用（ECharts）
├── editor.html / css/editor.css / js/editor.js  # 本地编辑器
├── data/books.json                              # 书目清单
├── data/<slug>.json                             # 每本书的数据
├── vendor/                                      # echarts、fflate（离线可用）
├── scripts/                                     # validate / draft / extract-epub
├── tools/push-via-api.ps1                       # 发布脚本
├── docs/                                        # 方案评估、示意图、预览页
└── sw.js / manifest.webmanifest                 # PWA 离线
```

---

## 部署与发布

- 部署：GitHub 仓库 → Settings → Pages → `main` / `/ (root)`
- 发布：改完数据后跑 `tools\push-via-api.ps1`（从 Git 凭据管理器取 token，走 GitHub API 建 blob/tree/commit，再更新分支）
- **改前端资源后要同步两处**：`sw.js` 里的 `CACHE = 'bookatlas-vNN'` 版本号，以及 `editor.html` 里资源引用的 `?v=NN`（并把带版本号的 URL 加进 SW 的预缓存清单），否则老访客会一直看到旧代码

---

## 常见问题

**双击 `index.html` 空白/报错？** 数据是 `fetch` 读的，需要本地服务：用 `本地预览.bat` 或 `python -m http.server`。

**PDF 上传没反应？** 浏览器端没做 PDF 正文抽取（太重），请先用 Calibre 等转成 txt/epub。

**AI 报 CORS / 失败？** 浏览器直连需要端点允许跨域（DeepSeek 官方可以）；不行就用命令行 `draft.mjs`。Key 只存本机，永远不会上传到本项目。

**改了代码/数据没生效？** 是 Service Worker 缓存：刷新一次；改代码时记得按上面"两处版本号"同步。

**会不会剧透？** 开「剧透保护」并选好进度；也可以先把「标签」切成"主要"减少信息量。

---

## 版权与致谢

- 原著文本与书名版权归各自权利人所有；本仓库只收录**阅读辅助数据**（人物、关系、事件的结构化整理），不收录原文正文
- 《百年孤独》家族树参考：Wikimedia Commons（作者 Michel Bakni，CC BY-SA 4.0）
- 图表库 [Apache ECharts](https://echarts.apache.org/)（Apache-2.0）、EPUB 解压 [fflate](https://github.com/101arrowz/fflate)（MIT）
- 思路参考 [story-graph](https://github.com/Drwei3155/story-graph)（MIT）——本项目数据不依赖 AI 生成，AI 只当草稿工具
