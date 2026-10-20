/**
 * zustand 状态管理：任务链列表 + 执行运行时
 *
 * ── 计时精度的核心决策 ──────────────────────────────────────────────
 * 倒计时**不采用"每 tick 减 1 秒"的累减模型**，而是记录当前阶段的
 * **结束时间戳** `runDeadline`，任意时刻的剩余时间都由
 * `deadline - Date.now()` 现算。
 *
 * 这样做的收益：
 * - 丢帧、锁屏、切后台都不会产生累积误差（累减模型每次丢一个 tick 就永久少 1 秒）；
 * - 从后台回前台时，只要用**当前时间戳**重新算一次，就能一次性把所有跨过的
 *   阶段推进完，不需要"补跑"几百个 tick。
 *
 * 正因为状态机是时间戳驱动的，`tick`（定时心跳）与 `reconcile`（回前台对账）
 * 在实现上会收敛成同一个操作 —— 这是刻意为之，不是巧合。保留两个名字是因为
 * 调用点的语义不同，将来若要为二者加不同策略（例如心跳降频省电）也有落点。
 */

import { create } from 'zustand';

import * as planRepository from '../db';
import {
  PHASE_SOUND,
  type Plan,
  type PlanSummary,
  type RunAlert,
  type RunPhase,
  type RunState,
  type SavePlanInput,
} from '../types';
import { toErrorMessage } from '../utils/format';

/** 与 `RunState` 的初始形状一致；导出给测试与执行页复用。 */
export const INITIAL_RUN_STATE: RunState = {
  planId: null,
  status: 'idle',
  currentIndex: 0,
  remainingSec: 0,
  phase: 'step',
};

/** 心跳间隔。500ms 而非 1000ms：剩余秒数虽然每秒才变一次，但更密的心跳让
 *  「阶段刚好结束」的那一刻最多只晚 0.5 秒被处理，切换更跟手。 */
export const TICK_INTERVAL_MS = 500;

/**
 * 状态机单步推进的上限。
 * 正常时长被校验限制在 10 秒以上，这个上限永远不会触发；
 * 但它能保证即使库里出现了 0 时长的脏数据，UI 线程也不会卡在死循环里。
 */
const MAX_PHASE_STEPS = 512;

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PhaseTransition {
  kind: 'step' | 'rest' | 'finished';
  index: number;
}

interface AdvanceResult {
  index: number;
  phase: RunPhase;
  /** 新的阶段结束时间戳；已完成时为 Number.POSITIVE_INFINITY。 */
  deadline: number;
  finished: boolean;
  transitions: PhaseTransition[];
}

/** 提醒序号：模块级计数器即可，不需要进 store（进 store 只会引发无谓渲染）。 */
let alertSeq = 0;

function stepAt(plan: Plan, index: number) {
  return plan.steps[index];
}

/**
 * 纯函数状态机：从 (index, phase, deadline) 出发，把所有 `now` 已经越过的阶段
 * 一次性推进完，返回落点与途中发生的全部阶段切换。
 *
 * 之所以返回"全部切换"而不是只返回落点：live 心跳时它用来播报当前阶段，
 * 追帧时它用来统计被跳过了几步。
 */
function advance(
  plan: Plan,
  index: number,
  phase: RunPhase,
  deadline: number,
  now: number,
): AdvanceResult {
  const lastIndex = plan.steps.length - 1;
  const transitions: PhaseTransition[] = [];

  let cursorIndex = index;
  let cursorPhase = phase;
  let cursorDeadline = deadline;

  let guard = 0;
  while (now >= cursorDeadline) {
    guard += 1;
    if (guard > MAX_PHASE_STEPS) {
      break;
    }

    const current = stepAt(plan, cursorIndex);

    // 步骤阶段结束：若该步声明了停歇，先进入 rest
    if (cursorPhase === 'step' && current !== undefined && current.restAfterSec > 0) {
      cursorPhase = 'rest';
      cursorDeadline += current.restAfterSec * 1000;
      transitions.push({ kind: 'rest', index: cursorIndex });
      continue;
    }

    // 走到这里有两种情况：步骤没有停歇，或停歇已经结束 → 进入下一步
    if (cursorIndex >= lastIndex) {
      transitions.push({ kind: 'finished', index: cursorIndex });
      return {
        index: lastIndex,
        phase: 'step',
        deadline: Number.POSITIVE_INFINITY,
        finished: true,
        transitions,
      };
    }

    cursorIndex += 1;
    cursorPhase = 'step';
    const next = stepAt(plan, cursorIndex);
    cursorDeadline += (next?.durationSec ?? 0) * 1000;
    transitions.push({ kind: 'step', index: cursorIndex });
  }

  return { index: cursorIndex, phase: cursorPhase, deadline: cursorDeadline, finished: false, transitions };
}

function stepAlert(plan: Plan, index: number, skippedPhases: number): RunAlert {
  const step = stepAt(plan, index);
  alertSeq += 1;
  return {
    seq: alertSeq,
    kind: 'step',
    stepTitle: step?.title ?? null,
    stepContent: step?.content ?? null,
    sound: step?.alertSound ?? PHASE_SOUND.step,
    skippedPhases,
  };
}

function restAlert(plan: Plan, index: number, skippedPhases: number): RunAlert {
  // 休息时预告"即将开始的下一步"，让用户知道休息完要做什么
  const upcoming = stepAt(plan, index + 1);
  alertSeq += 1;
  return {
    seq: alertSeq,
    kind: 'rest',
    stepTitle: upcoming?.title ?? null,
    stepContent: upcoming?.content ?? null,
    sound: PHASE_SOUND.rest,
    skippedPhases,
  };
}

function finishedAlert(skippedPhases: number): RunAlert {
  alertSeq += 1;
  return {
    seq: alertSeq,
    kind: 'finished',
    stepTitle: null,
    stepContent: null,
    sound: PHASE_SOUND.finished,
    skippedPhases,
  };
}

/**
 * 把一串阶段切换压缩成**一次**提醒。
 *
 * 只取最后一次切换：如果 App 在后台待了很久、一次跨过了 6 个阶段，
 * 补偿式地连播 6 声提示音毫无意义，用户回到前台时只需要知道"现在在哪一步"。
 * 被跳过的数量通过 `skippedPhases` 告知 UI。
 */
function alertFromTransitions(plan: Plan, transitions: PhaseTransition[]): RunAlert | null {
  if (transitions.length === 0) {
    return null;
  }
  const landed = transitions[transitions.length - 1];
  const skippedPhases = transitions.length - 1;

  switch (landed.kind) {
    case 'step':
      return stepAlert(plan, landed.index, skippedPhases);
    case 'rest':
      return restAlert(plan, landed.index, skippedPhases);
    case 'finished':
      return finishedAlert(skippedPhases);
  }
}

interface PlanStore {
  // ── 列表 ──────────────────────────────────────────────
  plans: PlanSummary[];
  listStatus: LoadStatus;
  listError: string | null;

  // ── 当前任务（编辑器 / 执行页共用的完整对象） ────────────
  activePlan: Plan | null;

  // ── 执行运行时 ────────────────────────────────────────
  run: RunState;
  /** 当前阶段结束时刻（epoch ms）。null = 未在计时（idle / paused / finished）。 */
  runDeadline: number | null;
  /** 暂停瞬间锁定的剩余毫秒。用毫秒而不是秒，避免反复暂停累积秒级误差。 */
  pausedRemainingMs: number | null;
  /** 最近一次阶段切换提醒。音频 / 震动 / 横幅共用它作为触发源。 */
  alert: RunAlert | null;

  // ── actions ──────────────────────────────────────────
  loadPlans: () => Promise<void>;
  loadPlanById: (id: string) => Promise<Plan | null>;
  savePlan: (input: SavePlanInput) => Promise<Plan>;
  deletePlan: (id: string) => Promise<void>;

  startRun: (plan: Plan) => void;
  pauseRun: () => void;
  resumeRun: () => void;
  stopRun: () => void;
  clearRun: () => void;
  /** 定时心跳。 */
  tick: () => void;
  /** 从后台回到前台时按时间戳对账。 */
  reconcile: () => void;
  dismissAlert: () => void;
}

export const usePlanStore = create<PlanStore>()((set, get) => {
  /**
   * tick 与 reconcile 的共同实现。
   * 未到 deadline 时只刷新展示用的剩余秒数；已过 deadline 时推进状态机。
   */
  function sync(now: number): void {
    const state = get();
    if (state.run.status !== 'running' || state.runDeadline === null || state.activePlan === null) {
      return;
    }

    if (now < state.runDeadline) {
      const remainingSec = Math.max(0, Math.ceil((state.runDeadline - now) / 1000));
      // 只在整秒真正变化时 set：心跳是 500ms 一次，若不判断会白白多出一倍渲染
      if (remainingSec !== state.run.remainingSec) {
        set({ run: { ...state.run, remainingSec } });
      }
      return;
    }

    const plan = state.activePlan;
    const result = advance(plan, state.run.currentIndex, state.run.phase, state.runDeadline, now);
    const remainingSec = result.finished
      ? 0
      : Math.max(0, Math.ceil((result.deadline - now) / 1000));

    set({
      run: {
        planId: plan.id,
        status: result.finished ? 'finished' : 'running',
        currentIndex: result.index,
        remainingSec,
        phase: result.phase,
      },
      runDeadline: result.finished ? null : result.deadline,
      pausedRemainingMs: null,
      alert: alertFromTransitions(plan, result.transitions) ?? state.alert,
    });
  }

  return {
    plans: [],
    listStatus: 'idle',
    listError: null,
    activePlan: null,
    run: INITIAL_RUN_STATE,
    runDeadline: null,
    pausedRemainingMs: null,
    alert: null,

    loadPlans: async () => {
      set({ listStatus: 'loading', listError: null });
      try {
        const plans = await planRepository.listPlanSummaries();
        set({ plans, listStatus: 'ready' });
      } catch (error) {
        set({ listStatus: 'error', listError: toErrorMessage(error) });
      }
    },

    loadPlanById: async (id) => {
      const plan = await planRepository.getPlanById(id);
      if (plan !== null) {
        set({ activePlan: plan });
      }
      return plan;
    },

    savePlan: async (input) => {
      const saved = await planRepository.savePlan(input);
      // 刻意不写 activePlan：保存动作可能发生在另一条任务链正在执行的时候，
      // 覆盖 activePlan 会把正在跑的计时器搞乱。
      await get().loadPlans();
      return saved;
    },

    deletePlan: async (id) => {
      const { run } = get();
      // 规格 E：删除正在执行的任务时必须先终止，否则计时器会指向一条不存在的链
      if (run.planId === id && run.status !== 'idle') {
        get().stopRun();
      }
      await planRepository.deletePlan(id);
      if (get().activePlan?.id === id) {
        set({ activePlan: null });
      }
      await get().loadPlans();
    },

    startRun: (plan) => {
      const first = plan.steps[0];
      if (first === undefined) {
        // 没有步骤的链不允许执行（规格 E：没有步骤的任务不允许保存，这里是兜底）
        return;
      }
      const now = Date.now();
      set({
        activePlan: plan,
        run: {
          planId: plan.id,
          status: 'running',
          currentIndex: 0,
          remainingSec: first.durationSec,
          phase: 'step',
        },
        runDeadline: now + first.durationSec * 1000,
        pausedRemainingMs: null,
        // 第一步也要提醒，否则用户点进去后听不到任何反馈
        alert: stepAlert(plan, 0, 0),
      });
    },

    pauseRun: () => {
      const state = get();
      if (state.run.status !== 'running' || state.runDeadline === null) {
        return;
      }
      const remainingMs = Math.max(0, state.runDeadline - Date.now());
      set({
        run: {
          ...state.run,
          status: 'paused',
          remainingSec: Math.max(0, Math.ceil(remainingMs / 1000)),
        },
        runDeadline: null,
        pausedRemainingMs: remainingMs,
      });
    },

    resumeRun: () => {
      const state = get();
      if (state.run.status !== 'paused' || state.pausedRemainingMs === null) {
        return;
      }
      const remainingMs = state.pausedRemainingMs;
      set({
        run: {
          ...state.run,
          status: 'running',
          remainingSec: Math.max(0, Math.ceil(remainingMs / 1000)),
        },
        runDeadline: Date.now() + remainingMs,
        pausedRemainingMs: null,
      });
    },

    stopRun: () => {
      set({
        run: INITIAL_RUN_STATE,
        runDeadline: null,
        pausedRemainingMs: null,
        alert: null,
      });
    },

    clearRun: () => {
      set({
        run: INITIAL_RUN_STATE,
        runDeadline: null,
        pausedRemainingMs: null,
        alert: null,
        activePlan: null,
      });
    },

    tick: () => {
      sync(Date.now());
    },

    reconcile: () => {
      sync(Date.now());
    },

    dismissAlert: () => {
      set({ alert: null });
    },
  };
});
