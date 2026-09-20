# 书脉 BookAtlas

把一本书的**人物关系**、**定义关系的小事件**与**标志性事件**放在一张图上：关系网络 + 阶段事件轴 + 「两人关系」最短链查询。多端自适应、可离线、可复用。

- 在线地址：`https://wakennorman.github.io/book-atlas/`
- 源码：`https://github.com/wakennorman/book-atlas`

## 功能

- **关系网络**：力导向图，节点按阵营着色、按关系数放大；点节点看档案，点连线看「关系 + 依据事件」
- **事件轴**：按阶段（建村 → 婚礼 → 内战 → 香蕉时代 → 大雨 → 飓风）列出标志性事件，点事件高亮相关人物
- **两人关系**：选两个人 → BFS 最短路 → 每一跳列出关系类型与定义该关系的小事件（本地计算，不依赖 AI）
- **阵营筛选 / 搜索 / 拖拽 / 深浅色**：图例点选聚焦某一阵营；搜索支持别名（如「上校」）
- **PWA**：可添加到手机主屏幕，离线可看（Service Worker 缓存）
- **多本可复用**：每本书一个 JSON，前端不改

## 本地预览

```bash
# 任选其一（需要 HTTP 服务，直接双击 file:// 会被浏览器拦截 fetch）
python -m http.server 8765
npx serve .
```

然后打开 `http://localhost:8765/`。

## 目录结构

```
book-atlas/
├── index.html                 # 单页应用
├── css/style.css
├── js/app.js                  # 渲染 / 交互 / BFS
├── vendor/echarts.min.js      # Apache-2.0
├── data/
│   ├── books.json             # 书目清单
│   └── one-hundred-years-of-solitude.json
├── assets/                    # 图标与参考图
├── research/                  # 外部项目研究（story-graph 等）
├── docs/                      # 方案与规范
└── sw.js / manifest.webmanifest
```

## 数据规范（v0.1）

```jsonc
{
  "meta":      { "slug": "", "title": "", "author": "", "prophecy": "", "note": "", "license": "", "sources": [] },
  "factions":  [{ "key": "", "name": "", "color": "#hex" }],
  "characters":[{ "id": "pinyin-kebab", "name": "", "aliases": [], "generation": 1, "faction": "", "title": "", "desc": "", "fate": "" }],
  "relations": [{ "from": "id", "to": "id", "type": "关系名", "style": "solid|dashed|dotted",
                  "events": [{ "text": "定义这段关系的小事件", "chapter": "第X章" }] }],
  "phases":    [{ "id": "p1", "name": "阶段名", "order": 1 }],
  "events":    [{ "id": "e01", "phase": "p1", "order": 1, "name": "", "chars": ["id"],
                  "summary": "", "impact": "", "quote": "" }]
}
```

要点：
- `style`：`solid` = 亲缘/同盟；`dashed` = 对立/伤害；`dotted` = 情人/过去/间接
- 没有明确年份的书用 `phase + order` 排序，**不要编造年份**
- `relations[].events` 优先收录「看着不起眼、但定义了两人关系」的小事件

## 加一本新书

1. 复制 `data/one-hundred-years-of-solitude.json` 为 `data/<新书 slug>.json`，按规范填写
2. 在 `data/books.json` 的 `books` 数组里加一行
3. 提交推送即可（前端无需改动）

## 部署（GitHub Pages）

仓库推送到 GitHub 后：Settings → Pages → Source 选 `Deploy from a branch` → `main` / `/ (root)`。
（本项目启用 Pages 用的就是这个设置。）

## 版权与致谢

- 《百年孤独》原著版权归权利人所有；本项目数据为阅读辅助整理（CC BY-SA 4.0）
- 家族树参考图：Wikimedia Commons，作者 Michel Bakni，CC BY-SA 4.0
- 图表库：[Apache ECharts](https://echarts.apache.org/)（Apache-2.0）
- 思路参考：[story-graph](https://github.com/Drwei3155/story-graph)（MIT）——但本项目数据不依赖 AI 生成，AI 只可作为草稿工具
