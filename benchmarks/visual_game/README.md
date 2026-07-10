# Visual-Game Bench · 快速/媒体版

一个面向**视觉动效 / 游戏代码生成**的轻量评测集。给模型一个提示词，让它产单文件 HTML（Canvas / CSS / WebGL），再对产物打分。专为**现场演示和媒体传播**设计：浏览器即开即看，视觉冲击力强，结果一目了然。

> 这是**结构 + 提示词模板**版本：包含目录结构、4 个任务的提示词（`query.md`）和能力契约（`task.yaml`）。打分引擎（三模态 rubric）是下一阶段，不在此版本。

## 为什么做这个

当前代码评测集中在"对不对"（算法、函数级），几乎不测"好看不好看、动不动、能不能玩"。V-GameGym（NeurIPS'25）的发现印证了这点：**所有模型代码维度都很强（70–97 分），但视觉/动效维度普遍极弱（0–22 分）**，还存在"代码-视觉权衡"（GPT-5 代码最强但视觉弱，o3 更均衡）。

这套评测专门切这个被忽视的维度，且**比 V-GameGym 更适合演示**——它是 web-native（单文件 HTML，浏览器即开），而 V-GameGym 是 Pygame/桌面/2219 题的科研规模。

## 目录结构

```
benchmarks/visual_game/
├── README.md                  # 本文件
├── capability_taxonomy.md     # 23 项能力契约 + 覆盖矩阵
└── tasks/
    ├── 01_css_loader_gallery/   # T1  纯 CSS · 6 个加载动画
    │   ├── task.yaml            #   元数据 + 能力映射（结构）
    │   └── query.md             #   提示词模板（给模型的）
    ├── 02_particle_fireworks/   # T2  Canvas · 粒子烟花
    ├── 03_tetris/               # T5  完整俄罗斯方块
    └── 04_game_2048/            # T7  2048（精确合并逻辑校验）
```

每个任务目录只有两个文件：
- **`query.md`** —— 提示词模板。直接喂给被测模型，要求产出 `deliverables/index.html`。
- **`task.yaml`** —— 任务元数据 + `capabilities` 能力契约（这个任务考察哪些能力、通过条件、证据、权重）。

## 四个任务

| # | 任务 | 难度 | 一句话 | 核心能力 |
|---|---|---|---|---|
| T1 | CSS 加载动画画廊 | easy | 纯 CSS（零 JS）6 个风格各异的 loader | CE-1 · VD-1 · VD-3 · VD-5 · IC-2 |
| T2 | Canvas 粒子烟花 | easy | 点击发射、重力、拖尾、爆炸、自动循环 | CE-2 · MP-1 · MP-3 · MP-4 · VD-1 · VD-3 · CE-5 · IC-2 |
| T5 | 俄罗斯方块 | medium | 7 方块/旋转/消行/计分/预览/game over | CE-2 · CE-4 · MP-1 · RS-3 · RS-4 · CE-5 · VD-2 |
| T7 | 2048 滑块合并 | medium | 4×4 合并翻倍/胜负/滑动动画 | RS-2 · CE-4 · RS-3 · CE-5 · VD-3 · MP-5 |

能力代码见 [capability_taxonomy.md](capability_taxonomy.md)（5 族 23 项）。

## 打分方法论（设计，待实现）

三模态 + 三档判定 + 四分档，对标 V-GameGym / WebGen-Bench：

1. **code 自动检查**（无头浏览器）—— 无 console error、画面随时间变化（在动）、注入交互后状态变化、FPS。每项判 **YES / NO / PARTIAL**（PARTIAL = 0.5）。
2. **image 截图裁判**（VLM）—— t=0/2/5s 截图，判配色/构图/动效/审美。
3. **video 录屏裁判**（VLM）—— 游戏片段，判动效流畅度/可玩性。

复合加权 → 四档：`excellent ≥0.8` · `good ≥0.6` · `fair ≥0.4` · `poor <0.4`。

**T7 是唯一能确定性判对错的任务**：通过 `window.__GAME.setBoard` 注入已知棋盘，按方向后断言合并结果（`2+2→4`）。

## 定位与对标

| 评测集 | 形态 | 规模 | 打分 | 与本套关系 |
|---|---|---|---|---|
| V-GameGym (NeurIPS'25) | Pygame/桌面 | 2219 题 | code+图+视频三模态 | 最接近，但非 web、科研规模；本套是 web-native 精炼版 |
| WebGen-Bench (NeurIPS'25) | 多文件网站 | 647 测试用例 | YES/NO/PARTIAL + 外观 1-5 | 借鉴其三档判定与外观维度；本套聚焦视觉/游戏 |
| 本套 | 单文件 HTML | 4 题（精炼） | 三模态 + 四档 | demo-ready、能力解构、浏览器即开 |

差异化：**web-native · demo-ready · 23 项能力解构**。

## 用法（提示词阶段）

1. 选一个任务，把 `tasks/<id>/query.md` 喂给被测模型。
2. 收模型产出的 `index.html`。
3. （打分引擎就绪后）跑 rubric 得三模态分 + 分档 + 能力雷达；现场可并排展示多模型产物的截图/录屏，或让观众 pairwise 投票。

## 演示叙事

照搬 V-GameGym 的故事线——"人人都能写出游戏循环（代码 80+），但几乎没人能让它好看（视觉 <22）；不同模型特长不同"。现场并排放各模型的烟花/俄罗斯方块录屏，观众一眼 get 差距。这正是视觉评测的核心说服力。
