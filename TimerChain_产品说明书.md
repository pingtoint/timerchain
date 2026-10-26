# TimerChain —— 产品说明书

> 版本：1.0 Preview  
> 日期：2026-10-22  
> 作者：胡洋 + AI Coding 协作

---

## 一、产品介绍

**TimerChain** 是一款面向运动训练、冥想专注、烹饪流程等场景的**链式计时** App。与单一倒计时器不同，TimerChain 允许用户把多个计时步骤串联成一条"任务链"，并在步骤之间自动插入停歇/间隙，形成完整的执行流程。

**核心功能**：

| 功能 | 说明 |
|------|------|
| 任务链管理 | 创建/编辑/删除/重排任务链，每条链由 N 个步骤组成 |
| 双模式步骤 | 每步可选择"时长模式"（N 秒倒计时）或"计次模式"（手动点完成第 N 遍），二选一 |
| Tabata 式重复 | 单步可重复 N 遍，遍间可设间隙（0 秒起，步长 1 秒） |
| 步骤间停歇 | 每步完成后自动进入 N 秒停歇，再进入下一步 |
| 后台执行 | 开始执行后 App 可最小化，通知栏常驻 FGS 卡片显示倒计时 + 暂停/终止按钮，锁屏可见 |
| 系统提醒 | 每条链可设一次性/每日/每周/每月定时提醒，到点弹通知 + 响铃，Android 上用 `delivery: alarmClock` 确保国产 ROM 不延迟 |
| AI 生成 | 集成主流 AI App（DeepSeek/豆包/Kimi/星火/通义/智谱/扣子），自然语言描述 → AI 生成任务链 JSON → 一键导入 |
| 导入/导出 | 任务链导出为自描述 JSON（含 `_readme` 字段），支持文件/剪贴板/AI 对话三种导入路径 |
| 多选合并 | 多选多条链 → 合并成一条，自动重排步骤序号 |

**目标平台**：Android 11+（本次构建目标）。iOS 因系统限制无前台服务对等机制，暂不支持后台常驻通知。

---

## 二、设计思路

### 2.1 问题空间

市场上的计时 App 分为两类：**单步倒计时**（如 Apple Timer、Hourglass）和**通用 Tabata 计时器**（如 Seconds、Tabata Timer）。前者无法处理多步串联，后者只能做固定格式的运动训练。TimerChain 瞄准的是**"任意多步流程的自动化执行"**——运动是最大场景，但烹饪（煮沸→焯水→炖煮）、冥想（呼吸→观照→回向）、甚至学习（阅读→笔记→复习）都是目标用户。

### 2.2 核心设计原则

| 原则 | 体现 |
|------|------|
| **时间戳驱动，不累积** | 倒计时不采用"每 tick 减 1 秒"，而是记录 `runDeadline`（阶段结束时刻），任意时刻剩余时间 = `deadline - Date.now()`。丢帧、锁屏、切后台零累积误差 |
| **状态机纯函数** | `advance(plan, index, repeatIndex, phase, deadline, now)` 是纯函数，不碰 RN / zustand / SQLite，可独立单元测试。后台追帧一次跨过 N 个阶段也只走一次循环 |
| **UI 无状态** | 执行页本身不含计时逻辑，心跳由 `useTimer()` 挂载在全局，页面只消费 store 里的 `run` 对象。页面卸载/重挂载不影响倒计时 |
| **互斥订阅** | 列表页不用 `state.run` 整体订阅，只取 `runningPlanId` 字符串——避免心跳 500ms 一次重渲染整个列表 |
| **原生能力优先** | 倒计时走 `showChronometer + chronometerDirection:'down' + timestamp`，Android 系统级走字，零 JS 开销。FGS 用 Notifee 的 `registerForegroundService`，同 id 更新通知而非重建 |
| **手势互斥** | 列表左滑互斥：滑开第二条时第一条自动收起（`onSwipeableOpenStartDrag` 比 `onSwipeableOpen` 早 200ms+）；右滑橡皮筋感：`renderLeftActions={() => <View style={{width:60}} />}` + `leftThreshold=MAX_SAFE_INTEGER` |
| **后台化不绑死** | 运行时离开执行页不终止任务（参考美团外卖/Keep），FGS 接管。只有显式点"终止"才二次确认 |

### 2.3 视觉设计

| 元素 | 设计 |
|------|------|
| 卡片 | 纯白底 + hairline 边框 + 左侧 4px accent bar（执行中=warning 橙、有提醒=primary 蓝、无=透明） |
| 执行中标记 | "执行中"胶囊 + 1.2s 循环透明度脉冲动效（reanimated withRepeat，零 JS 开销） |
| 主色 | `#2C6BED`（偏亮蓝），提醒/强调用；warning=`#F59E0B` 用于执行中状态 |
| 按钮 | 圆角 radius.lg（12px），danger 红 `#EF4444`，secondary 灰蓝背景 |

---

## 三、设计过程

### 3.1 技术选型

| 层 | 选择 | 理由 |
|----|------|------|
| 框架 | Expo SDK 58 + React Native 0.88 | 跨平台、prebuild 生成原生工程、config plugin 注入清单 |
| 路由 | Expo Router（`src/app/` 约定式路由） | 文件即路由、深链支持、`useRouter`/`useLocalSearchParams` |
| 状态 | zustand | 轻量、订阅粒度可精确到 selector、不强制 Provider |
| 持久化 | expo-sqlite（异步 API） | WAL 模式、逐列迁移、COALESCE 兜底 |
| 手势 | react-native-gesture-handler ReanimatedSwipeable | 旧版 Swipeable 已废弃，Reanimated 版支持 SharedValue 动画 |
| 通知 | Notifee v9.1.8 | registerForegroundService + showChronometer + actions，expo-notifications 做系统定时 |
| 构建 | 本地 gradle（EAS 配额用完） | 拉 EAS 证书保持签名一致，覆盖升级不丢数据 |

### 3.2 关键决策与取舍

| 决策 | 背景 | 取舍 |
|------|------|------|
| **deadline 驱动 vs 累减** | 累减每次丢 tick 永久少 1 秒 | 选 deadline：一次性追帧复杂度更高，但零累积误差 |
| **FGS vs WorkManager** | WorkManager 无法保证倒计时精度 | 选 FGS：前台服务优先级高，用户感知更明确 |
| **特殊 FGS 类型（Android 14）** | 普通类型可能被系统限制 | 用 `specialUse` + `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` 声明 |
| **FGS JS 层注册时机** | 启动即注册 vs 惰性注册 | 选启动即注册：createChannel 是 native 微秒级，惰性注册收益可忽略 |
| **runForeground 订阅过滤** | savePlan 改另一条链也触发回调 | snapshot 比对：`planId|title|status|index|repeat|phase|deadline|paused` |
| **FGS 方向判断** | 左滑露出右侧按钮 → SwipeDirection.LEFT（不是 RIGHT） | 两次踩坑：方向反了 + 空 renderLeftActions 导致右滑不动 |

### 3.3 测试覆盖

| 类型 | 覆盖 | 结果 |
|------|------|------|
| 静态分析 | tsc --noEmit | 零错误 |
| Lint | expo lint | 9 个既有 warning（set-state-in-effect），无新增 |
| 单元测试 | advance() 状态机 9 用例 47 断言 | 全部通过 |
| 手动冒烟 | 14 项（执行/暂停/终止/后台/提醒/AI 等） | 待用户验证 |

---

## 四、商业价值与产品创新性

### 4.1 市场定位

TimerChain 填补了"链式执行"这个细分空白：
- **运动**：Tabata / HIIT / 瑜伽序列 / 热身-主项-放松完整流程
- **烹饪**：多步骤菜谱自动计时（煲汤焯水 1 分钟 → 爆炒 3 分钟 → 收汁 2 分钟）
- **专注**：番茄钟 + 深度工作 + 冥想呼吸的链式组合
- **医疗康复**：物理治疗师预设的多动作康复序列

### 4.2 创新性

1. **时间戳驱动的链式状态机**——不是把多个独立倒计时串起来，而是统一在一个状态机里推进，支持计次/计时/停歇/间隙四种 phase 混合，后台追帧零累积误差
2. **双模式步骤**（时长/计次二选一）——一个步骤既能当倒计时器用，也能当手动推进的计数器用
3. **AI 生成 + 自描述 JSON 同构**——AI 提示词模板与任务数据结构完全同构，导出 JSON 含 `_readme` 字段确保大模型能按相同结构输出，AI 探测/导入/解析走统一容错链路
4. **FGS 通知栏链式控制**——不是简单的倒计时挂通知，而是在通知栏完整呈现当前 phase（步骤/停歇/间隙）、遍数、进度条、暂停/终止按钮
5. **手势互斥 + 橡皮筋感**——每个 SwipeRow 独立持有 ref，父级通过 `openOther()` 实现互斥，`renderLeftActions + leftThreshold=MAX_SAFE_INTEGER` 实现右滑橡皮筋回弹

### 4.3 商业化路径

| 阶段 | 方式 |
|------|------|
| MVP（当前） | 免费下载，内置 AI App 探测（用户已有 DeepSeek/豆包等 → 零成本 AI 生成） |
| 1.0 | 订阅制 ¥6/月：高级模板库、云同步、Apple Watch / Wear OS 配套 |
| 2.0 | B2B：与健身教练 / 康复机构 / 烹饪课程合作，提供专属链模板包 |

---

## 五、AI Coding 工具使用情况

### 5.1 工具

- **Trae**（基于大语言模型的 AI IDE）—— 本次开发全程使用的主工具
- **模型**：当前会话由 GLM-5.3-Flash 驱动

### 5.2 协作模式

| 阶段 | 人做 | AI 做 |
|------|------|-------|
| 需求 | 描述产品意图（"美团外卖那种通知栏效果"、"时长/次数二选一"、"左滑按钮顺序"） | 翻译为技术方案（Notifee FGS + showChronometer、两段 Switch、Swipeable renderRightActions） |
| 设计 | 定视觉方向（"主流手机 App 交互惯例"、"风格更美观有特色"） | 具体组件实现（accent bar 4px、RunningPill 脉冲动效、SwipeRow 互斥逻辑） |
| 编码 | 确认方案、审查输出、真机测试反馈 | 写代码、跑 tsc、修 lint、构建 APK、写单元测试 |
| 调试 | 真机截图 + 描述现象（"通知栏有消息但没按钮"、"右滑不动"） | 查 logcat、定位根因（direction 搞反、空 renderLeftActions、pressAction 位置错）、写修复 |

### 5.3 典型 AI 贡献

| 贡献 | 说明 |
|------|------|
| **Notifee FGS 集成** | 从选型到完整实现（registerForegroundService + snapshot 过滤 + actions + pressAction + BigText style），1 次性写对 |
| **SwipeRow 互斥 + 橡皮筋** | 两次方向踩坑后精准定位根因（direction 判断反了 + 空 renderLeftActions 导致 Swipeable 不识别方向） |
| **advance() 状态机纯函数 + 单元测试** | 从 store 里剥离出纯函数逻辑，写 9 个用例覆盖正常/追帧/计次/混合链/边界条件 |
| **run.tsx 导航修复** | 发现 `usePreventRemove(isActive)` 完全违背 FGS 设计初衷，重构为运行时自由离开 + 显式终止才确认 |
| **DB 优化** | reorderPlans 从 N 次 UPDATE 改为单条 CASE WHEN SQL，listReminderPlans 专用 SQL 跳过 GROUP BY |

### 5.4 效率对比

| 指标 | 纯人工（预估） | AI 协作（实际） |
|------|----------------|-----------------|
| 从仓库到可用 Preview | ~40-60 小时 | ~15-20 小时 |
| Notifee FGS 从 0 到跑通 | ~8 小时（读文档 + 踩坑） | ~1 小时 |
| SwipeRow 互斥修复 | ~4 小时（方向搞反要反复试） | 方向反了 → 1 轮定位 → 修复 |
| 单元测试覆盖 | ~6 小时 | ~1 小时（AI 写用例，人修正预期值） |

### 5.5 踩过的坑（AI + 人 共同学习）

| 坑 | 根因 | 修复 |
|----|------|------|
| Notifee 包名记错 | 写成 `@notifee/react-native-core`（404） | 正确包名 `@notifee/react-native` |
| `pressAction` 放根层级 | Notifee 不认，必须在 `android` 里 | 移到 `android.pressAction` |
| SwipeDirection 搞反 | 左滑露出右侧按钮时 `onSwipeableOpen` 的参数是 `LEFT` 不是 `RIGHT` | 两个判断都改 `LEFT` |
| 空 renderLeftActions | 宽度 0 → Swipeable 认为没有左面板 → 右滑不动 | 给 `{width:60}` 占位 + `leftThreshold=MAX_SAFE_INTEGER` |
| DeepSeek scheme 探测不到 | 真机注册的是 `dpsk://` 不是 `deepseek://`，且 Android 11+ 包可见性 | config plugin 注入 `<queries>` + 修正 scheme |
| EAS 配额用完 | 免费计划每月 10 次 Android 构建 | 转本地 gradle 构建 |

---

## 六、技术栈速查

```
Expo SDK 58 / React Native 0.88 / TypeScript
├── expo-router        (App 级路由)
├── zustand            (状态管理)
├── expo-sqlite        (持久化 WAL 模式)
├── Notifee 9.1.8      (前台服务通知)
├── expo-notifications (系统定时提醒)
├── RNGH ReanimatedSwipeable (手势)
├── reanimated 3.x     (动画)
└── Android 11+        (目标平台)
```

---

> 本说明书由 AI Coding 协作生成，代码可在 `c:\workspace\timerchain` 查看。
