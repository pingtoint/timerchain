/**
 * TimerChain 领域模型
 *
 * 这是 SQLite 表结构、zustand store 与所有 UI 组件共享的**单一类型来源**。
 * 任何字段改名都必须同步这里 —— 不要在别处重复声明 Plan / Step 的形状。
 */

export type AlertSound = 'chime' | 'beep' | 'none';

/** UI 层渲染提醒音选项时要保持的固定顺序。 */
export const ALERT_SOUNDS: readonly AlertSound[] = ['chime', 'beep', 'none'];

export const ALERT_SOUND_LABEL: Record<AlertSound, string> = {
  chime: '清脆',
  beep: '短促',
  none: '静音',
};

export interface Step {
  id: string;
  order: number;
  title: string;
  content: string;
  durationSec: number;
  restAfterSec: number;
  alertSound: AlertSound;
  videoUrl: string | null; // 预留字段，当前版本不消费，仅原样落库
}

export interface Plan {
  id: string;
  title: string;
  steps: Step[];
  createdAt: number;
  updatedAt: number;
}

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished';

export type RunPhase = 'step' | 'rest';

export interface RunState {
  planId: string | null;
  status: RunStatus;
  currentIndex: number;
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
}

/** 保存入参。`id` 为 null 表示新建，由数据层生成 id。 */
export interface SavePlanInput {
  id: string | null;
  title: string;
  steps: Step[];
}

export type RunAlertKind = 'step' | 'rest' | 'finished';

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
} as const;

/** 各类提醒对应的默认音效，供编辑器和 store 保持一致行为。 */
export const PHASE_SOUND: Record<RunAlertKind, AlertSound> = {
  step: 'chime',
  rest: 'beep',
  finished: 'chime',
};
