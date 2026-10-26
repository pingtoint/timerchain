/**
 * TimerChain 领域模型
 *
 * 这是 SQLite 表结构、zustand store 与所有 UI 组件共享的**单一类型来源**。
 * 任何字段改名都必须同步这里 —— 不要在别处重复声明 Plan / Step 的形状。
 */

export type AlertSound = 'chime' | 'beep' | 'none';

/** 计划级别的通知提示音（系统通知 soundName）。和步骤执行时的 AlertSound 独立。 */
export type NotificationSound = AlertSound | 'default';

/** 重复模式。'once' 用 scheduled_for 指定具体时间；daily / weekly / monthly 由 repeat_mask 细化。 */
export type RepeatMode = 'once' | 'daily' | 'weekly' | 'monthly';

/**
 * Reminder 配置。
 * reminder_enabled = false 时，其它字段可以是 null（草稿态）。
 * repeat_mask：
 *   weekly  → 工作日集合字符串，例如 "1,2,3,4,5"（ISO：周一=1，周日=7）
 *   monthly → 号数集合字符串，例如 "1,15,30"
 *   once / daily → 空
 * time_of_day：当天的秒数 0~86400（比如早上 8 点 = 28800）
 * scheduled_for：数据库里存的"下次触发时间戳"（epoch ms），是 computed 值
 *   — 由 repeat_mode + mask + time_of_day 推算出来，保存时重算
 */
export interface ReminderConfig {
  enabled: boolean;
  repeatMode: RepeatMode;
  /** 仅 once 模式需要：用户选的具体日期（Date 对象） */
  targetDate?: Date;
  /** 当天的秒数 0~86400 */
  timeOfDaySec?: number;
  weeklyMask?: string;   // "1,2,3,4,5"
  monthlyMask?: string;  // "1,15,30"
  /** 下次触发时间戳（epoch ms），保存时由 calcNextFire 算出 */
  scheduledFor?: number | null;
  /** 计划级别的通知提示音 */
  notificationSound?: NotificationSound;
}

/** UI 层渲染提醒音选项时要保持的固定顺序。 */
export const ALERT_SOUNDS: readonly AlertSound[] = ['chime', 'beep', 'none'];

export const ALERT_SOUND_LABEL: Record<AlertSound, string> = {
  chime: '清脆',
  beep: '短促',
  none: '静音',
};

/** 步骤计量方式：timed = 倒计时；count = 计次（手动点"完成本遍"推进，不计时）。 */
export type StepKind = 'timed' | 'count';

export interface Step {
  id: string;
  order: number;
  title: string;
  content: string;
  kind: StepKind;
  /** timed：倒计时秒数（≥10）。count：无意义，归一化置 0。 */
  durationSec: number;
  restAfterSec: number;
  /**
   * count：要做的遍数（≥1），执行时逐遍手动完成。
   * timed：恒为 1（计时步骤不重复），归一化强制。
   */
  repeatCount: number;
  /** 每两遍之间的间隙秒数，0 起、步长 1 秒；repeatCount 为 1 时归一化置 0。 */
  repeatRestSec: number;
  alertSound: AlertSound;
  videoUrl: string | null; // 预留字段，当前版本不消费，仅原样落库
}

export interface Plan {
  id: string;
  title: string;
  steps: Step[];
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
  reminder: ReminderConfig | null;
}

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished';

export type RunPhase = 'step' | 'rest' | 'repeatRest';

export interface RunState {
  planId: string | null;
  status: RunStatus;
  currentIndex: number;
  /** 当前步骤的第几遍（0 起）。repeatCount 为 1 时恒为 0。 */
  repeatIndex: number;
  /** timed：阶段剩余秒数；count 步骤的计次阶段：已进行秒数（正数计时）。 */
  remainingSec: number;
  phase: RunPhase;
}

/**
 * 列表页使用的轻量摘要。
 *
 * 刻意不返回完整 Plan：列表只需要"3 步 · 约 12 分钟"，把步骤全部读出来会让
 * 首屏 IO 随任务数量线性膨胀。
 */
export interface PlanSummary {
  id: string;
  title: string;
  stepCount: number;
  totalDurationSec: number; // 含停歇时长，反映真实占用的墙钟时间
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
  reminder: ReminderConfig | null;
}

/** 保存入参。`id` 为 null 表示新建，由数据层生成 id。 */
export interface SavePlanInput {
  id: string | null;
  title: string;
  steps: Step[];
  reminder?: ReminderConfig | null;
}

export type RunAlertKind = 'step' | 'rest' | 'repeatRest' | 'finished';

/**
 * 计时器在阶段切换时向上层抛出的一次性事件。
 *
 * 音频、震动、顶部横幅三种反馈全部消费同一个对象，避免三条各自独立的
 * 事件通道互相不同步。
 */
export interface RunAlert {
  /** 单调递增序号。内容完全相同的两次提醒（例如两步同名）也能被区分。 */
  seq: number;
  kind: RunAlertKind;
  /** 步骤开始时是当前步骤；休息阶段是"即将开始的下一步"，用于预告。 */
  stepTitle: string | null;
  stepContent: string | null;
  sound: AlertSound;
  /** App 在后台停留过久、追帧时被跨过的阶段数。> 0 时 UI 会说明"已跳过 N 步"。 */
  skippedPhases: number;
}

/** 步骤时长 / 停歇时长的合法区间。选择器与校验共用，避免两处各写一遍。 */
export const STEP_LIMITS = {
  durationMinSec: 10,
  durationMaxSec: 60 * 60,
  restMinSec: 0,
  restMaxSec: 30 * 60,
  repeatMaxCount: 99,
  repeatRestMaxSec: 10 * 60,
} as const;

/** 各类提醒对应的默认音效，供编辑器和 store 保持一致行为。 */
export const PHASE_SOUND: Record<RunAlertKind, AlertSound> = {
  step: 'chime',
  rest: 'beep',
  repeatRest: 'beep',
  finished: 'chime',
};
