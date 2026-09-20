# 📚 小说人物关系图谱

> 输入任意小说名，AI 自动生成可视化人物关系网络图。支持自然语言搜索、AI 关系推理、多书对比、语音朗读。

![](https://img.shields.io/badge/status-active-brightgreen)
![](https://img.shields.io/badge/license-MIT-blue)
![](https://img.shields.io/badge/tech-vanilla%20JS-yellow)

## ✨ 功能

### 🎯 核心
- **AI 一键生成** — 输入小说名，DeepSeek 自动分析角色、阵营、关系、事件
- **力导向图可视化** — 基于 vis.js 的交互式人物关系网络
- **点击查看详情** — 点角色看介绍、关系列表、所在阵营
- **历史事件时间轴** — 底部时间轴串联关键事件，点击高亮相关角色

### 🔍 智能搜索
- **自然语言问答** — 问"孙悟空的师傅是谁"直接高亮答案
- **双角色路径** — "刘备和曹操什么关系"显示关系路径 + AI 解释
- **语音搜索** — 支持 Chrome 语音识别，说话就能搜
- **搜索历史** — 自动记录搜索，点击可重新查询

### 🛠 编辑与导出
- **拖拽编辑** — 开启编辑模式自由调整节点位置，保存布局
- **自定义关系** — 手动添加/修改/删除角色之间的连线
- **阵营筛选** — 点图例只看某个阵营，聚焦特定势力
- **图片导出** — 一键导出高清 PNG 图谱

### 🎨 体验
- **暗色/亮色主题** — 一键切换，刷新保持偏好
- **多书标签页** — 加载多本小说，标签页快速切换对比
- **移动端适配** — 自适应手机平板，底部面板操作
- **数据统计面板** — 角色数、关系数、阵营分布、核心角色排行
- **关系语音朗读** — AI 解释一键播放（Web Speech API）
- **进度条加载** — 多阶段进度提示，清晰可见
- **分享链接** — 复制 URL 发给朋友，自动加载指定小说

## 🚀 快速开始

### 1. 安装

```bash
git clone https://github.com/Drwei3155/story-graph.git
cd story-graph
npm install
```

### 2. 配置 API Key

```bash
cp .env.example .env
# 编辑 .env，填入你的 DeepSeek API Key
# DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
```

获取 Key：[DeepSeek 开放平台](https://platform.deepseek.com/)

### 3. 启动

```bash
node server.js
```

浏览器打开 `http://localhost:3000`

## 🌐 在线体验

部署地址：`https://story-graph.onrender.com`

> 免费 Render 实例闲置 15 分钟后休眠，唤醒约需 30 秒。

也可以直接浏览器使用：点击「更换小说」→「设置 API Key」→ 输入自己的 Key 即可直连。

## 📖 预设示例

| 小说 | 角色 | 关系 | 事件 |
|------|------|------|------|
| 三国演义 | 40 | 60+ | 16 |
| 红楼梦 | 30+ | 50+ | 12 |
| 西游记 | 25+ | 45+ | 10 |
| 水浒传 | 35+ | 55+ | 12 |

> 运行 `node generate-examples.js` 批量生成以上示例的缓存。

## 🏗️ 技术架构

```
story-graph/
├── index.html          # 前端（单文件，vanilla JS + vis.js）
├── server.js           # Express 后端（API 代理 + 缓存）
├── generate-examples.js # 批量生成经典小说示例
├── cache/              # API 响应缓存（JSON 文件）
└── package.json
```

### 技术栈

| 层 | 技术 |
|----|------|
| 前端 | vanilla JS, vis.js (vis-network + vis-data), html2canvas |
| 后端 | Node.js + Express |
| AI | DeepSeek API (OpenAI 兼容) |
| 语言 | 单文件纯 HTML/CSS/JS，零构建步骤 |

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/generate` | 生成小说人物关系图谱 |
| POST | `/api/search` | 自然语言智能搜索 |
| POST | `/api/explain-path` | AI 解释关系路径 |

## 📸 截图

> 添加应用截图到 `screenshots/` 目录，然后在下方引用。

```
screenshots/
├── graph-overview.png     # 全图概览
├── search-result.png      # 搜索结果
├── edit-mode.png          # 编辑模式
├── stats-panel.png        # 统计面板
├── mobile-view.png        # 移动端
└── theme-light.png        # 亮色主题
```

## 🔒 安全

- `.env` 已加入 `.gitignore`，API Key 不会提交到仓库
- 支持浏览器直连模式，Key 仅保存在本地 sessionStorage
- 服务端缓存 `cache/` 目录已忽略，不进入版本控制

## 📝 License

MIT © [Drwei3155](https://github.com/Drwei3155)
