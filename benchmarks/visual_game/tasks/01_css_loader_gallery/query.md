# 任务：CSS 加载动画画廊

用**单个 `index.html` 文件**（纯 CSS，**零 JavaScript**，不引入任何 JS）实现一个"加载动画画廊"页面。

## 需求

1. 页面里并排或网格排列 **6 个**加载动画（loading indicator），每个风格不同，例如：
   - 经典旋转 spinner
   - 形变/缩放脉冲
   - skeleton 占位条
   - 液态/波浪
   - 渐变轨道环绕
   - 3D 翻转立方体
   （以上仅为示例，可自由设计，但必须 6 个**视觉上彼此 distinct**。）
2. 6 个动画**都在持续运动**，且各自有不同的 `@keyframes` / `animation-name`。
3. 配色统一协调，整体观感现代、精致。
4. **不得使用任何 JavaScript**（`<script>` 标签不得出现，也不得用内联事件处理器）。所有动效必须纯 CSS 实现。
5. 单文件、零外部依赖（可用 Google Fonts 等 CDN，但核心动效不依赖网络）。

## 交付

把成品写到 `deliverables/index.html`（双击即可在浏览器打开运行）。

## 评分会检查（rubric）

- 无 `<script>`（纯 CSS）
- 有 ≥ 6 个元素带非 none 的 `animation-name`，且彼此 distinct（不同 keyframes）
- 6 个 loader 都在动（CSS 动画采样 t0/t1 不同）
- 无 console error
- 视觉裁判打分：配色、构图、动效流畅度、审美
