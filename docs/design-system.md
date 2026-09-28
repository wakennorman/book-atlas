# 书脉 BookAtlas · 混合版设计系统

> 来源：ui-ux-pro-max（核心）+ ui-new（优点融合）
> 适用：阅读工具、数据可视化、仪表盘类 Web 应用

---

## 设计原则

| 原则 | 说明 |
|---|---|
| **克制的奢华** | 不是堆砌，而是精准取舍 |
| **系统性思维** | 每个组件都来自同一设计语言 |
| **情绪传达** | 界面有温度，有性格，不是功能机器 |
| **细节决定品质** | 阴影、圆角、间距都是设计语言 |

---

## 配色方案

### 主色（ui-ux-pro-max 蓝色系）

| 变量 | 值 | 用途 |
|---|---|---|
| `--color-primary` | `#4A6CF7` | 主色：按钮、链接、高亮 |
| `--color-primary-light` | `#6B8AFF` | 主色浅：悬浮态 |
| `--color-primary-dark` | `#3A5CE0` | 主色深：按下态 |
| `--color-primary-container` | `#E8EDFF` | 主色容器：标签背景 |
| `--color-on-primary-container` | `#1A2B6B` | 主色容器上的文字 |

### 语义色

| 变量 | 值 | 用途 |
|---|---|---|
| `--color-success` | `#28A745` | 成功、通过 |
| `--color-warning` | `#FFC107` | 警告、注意 |
| `--color-danger` | `#DC3545` | 危险、错误 |

### 中性色

| 变量 | 值 | 用途 |
|---|---|---|
| `--color-bg` | `#F8F9FA` | 页面背景 |
| `--color-surface` | `#FFFFFF` | 卡片、面板背景 |
| `--color-surface-soft` | `#F1F3F5` | 次要背景 |
| `--color-text` | `#212529` | 主要文字 |
| `--color-text-muted` | `#6C757D` | 次要文字 |
| `--color-border` | `#DEE2E6` | 边框 |

---

## 圆角

| 变量 | 值 | 用途 |
|---|---|---|
| `--radius-sm` | `8px` | 小圆角：标签、输入框 |
| `--radius-md` | `12px` | 中圆角：按钮、卡片 |
| `--radius-lg` | `16px` | 大圆角：面板、模态框 |
| `--radius-xl` | `24px` | 超大圆角：胶囊标签 |

---

## 阴影

| 变量 | 值 | 用途 |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.08)` | 轻微阴影：卡片 |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.1)` | 中等阴影：悬浮态 |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.12)` | 大阴影：模态框 |

---

## 字体

| 变量 | 值 | 用途 |
|---|---|---|
| `--font-sans` | `'Noto Sans SC', -apple-system, ...` | 正文、UI 元素 |
| `--font-serif` | `'Noto Serif SC', Georgia, serif` | 标题 |

### 字体层级

| 类名 | 大小 | 字重 | 行高 | 用途 |
|---|---|---|---|---|
| `.font-h1` | 32px | 700 | 1.25 | 页面标题 |
| `.font-h2` | 24px | 600 | 1.3 | 区块标题 |
| `.font-body` | 15px | 400 | 1.6 | 正文 |
| `.font-caption` | 13px | 400 | 1.5 | 注释、说明 |

---

## 动效

| 变量 | 值 | 用途 |
|---|---|---|
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性曲线：按钮、卡片 |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | 标准曲线：淡入淡出 |
| `--duration-short` | `200ms` | 微交互：按钮按下 |
| `--duration-medium` | `300ms` | 标准转场：悬浮、展开 |

---

## 组件

### 按钮

```html
<button class="btn btn-primary">主要操作</button>
<button class="btn btn-secondary">次要操作</button>
<button class="btn btn-ghost">文字按钮</button>
```

### 卡片

```html
<div class="card">
  <div class="font-h2">标题</div>
  <div class="font-body">内容</div>
</div>
```

### 输入框

```html
<input class="input" placeholder="请输入...">
```

### 工具栏

```html
<div class="toolbar">
  <div class="toolbar-group">
    <button class="btn btn-secondary">按钮</button>
  </div>
  <div class="toolbar-divider"></div>
  <div class="toolbar-group">
    <input class="input" placeholder="搜索...">
  </div>
</div>
```

### 标签

```html
<span class="chip chip-primary">血缘</span>
<span class="chip chip-success">婚姻</span>
<span class="chip chip-warning">结义</span>
<span class="chip chip-danger">敌对</span>
```

---

## 深色模式

在 `<html>` 或 `<body>` 上加 `data-theme="dark"`：

```html
<html data-theme="dark">
```

---

## 使用方式

### 1. 引入 CSS

```html
<link rel="stylesheet" href="shared/design-system.css">
```

### 2. 使用 class

```html
<button class="btn btn-primary">主要操作</button>
<div class="card">...</div>
```

### 3. 自定义

覆盖 CSS 变量：

```css
:root {
  --color-primary: #FF6B6B; /* 换成你的品牌色 */
}
```

---

## 设计来源

- **ui-ux-pro-max**（Skill-CN）：配色、圆角、阴影
- **ui-new**（SkillHub）：字体、动效、语义色

---

## 参考

- [Google Material Design 3](https://m3.material.io/)
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC)
- [Noto Serif SC](https://fonts.google.com/noto/specimen/Noto+Serif+SC)
