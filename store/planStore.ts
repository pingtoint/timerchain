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
import * as notificationService from '../notifications/notificationService';
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
  repeatIndex: 0,
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
  kind: 'step' | 'rest' | 'repeatRest' | 'finished';
  index: number;
  /** 切换后处于第几遍（0 起），供播报"第 2/8 遍"。 */
  repeat: number;
}

interface AdvanceResult {
  index: number;
  repeatIndex: number;
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
  repeatIndex: number,
  phase: RunPhase,
  deadline: number,
  now: number,
): AdvanceResult {
  const lastIndex = plan.steps.length - 1;
  const transitions: PhaseTransition[] = [];

  let cursorIndex = index;
  let cursorRepeat = repeatIndex;
  let cursorPhase = phase;
  let cursorDeadline = deadline;

  // 计次阶段没有自然 deadline（INFINITY），从它往后推进时以 now 为锚点累积
  const anchor = (d: number) => (d === Number.POSITIVE_INFINITY ? now : d);
  const stepPhaseDeadline = (base: number, step: Plan['steps'][number] | undefined) =>
    step?.kind === 'count'
      ? Number.POSITIVE_INFINITY
      : anchor(base) + (step?.durationSec ?? 0) * 1000;

  let guard = 0;
  while (now >= cursorDeadline) {
    guard += 1;
    if (guard > MAX_PHASE_STEPS) {
      break;
    }

    const current = stepAt(plan, cursorIndex);

    if (cursorPhase === 'step' && current !== undefined) {
      // 一遍结束：还有下一遍 → 间隙（>0 秒时）或直接开下一遍
      if (cursorRepeat < current.repeatCount - 1) {
        if (current.repeatRestSec > 0) {
          cursorPhase = 'repeatRest';
          cursorDeadline = anchor(cursorDeadline) + current.repeatRestSec * 1000;
          transitions.push({ kind: 'repeatRest', index: cursorIndex, repeat: cursorRepeat });
          continue;
        }
        cursorRepeat += 1;
        cursorDeadline = stepPhaseDeadline(cursorDeadline, current);
        transitions.push({ kind: 'step', index: cursorIndex, repeat: cursorRepeat });
        continue;
      }

      // 全部遍数完成：有停歇先进入 rest
      if (current.restAfterSec > 0) {
        cursorPhase = 'rest';
        cursorDeadline = anchor(cursorDeadline) + current.restAfterSec * 1000;
        transitions.push({ kind: 'rest', index: cursorIndex, repeat: cursorRepeat });
        continue;
      }
    }

    // 间隙结束 → 同一步的下一遍
    if (cursorPhase === 'repeatRest' && current !== undefined) {
      cursorRepeat += 1;
      cursorPhase = 'step';
      cursorDeadline = stepPhaseDeadline(cursorDeadline, current);
      transitions.push({ kind: 'step', index: cursorIndex, repeat: cursorRepeat });
      continue;
    }

    // 走到这里：停歇已结束（或本步无停歇）→ 进入下一步或全部完成
    if (cursorIndex >= lastIndex) {
      transitions.push({ kind: 'finished', index: cursorIndex, repeat: cursorRepeat });
      return {
        index: lastIndex,
        repeatIndex: 0,
        phase: 'step',
        deadline: Number.POSITIVE_INFINITY,
        finished: true,
        transitions,
      };
    }

    cursorIndex += 1;
    cursorRepeat = 0;
    cursorPhase = 'step';
    cursorDeadline = stepPhaseDeadline(cursorDeadline, stepAt(plan, cursorIndex));
    transitions.push({ kind: 'step', index: cursorIndex, repeat: 0 });
  }

  return {
    index: cursorIndex,
    repeatIndex: cursorRepeat,
    phase: cursorPhase,
    deadline: cursorDeadline,
    finished: false,
    transitions,
  };
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
    case 'repeatRest': {
      // 间隙 = 同一部的两遍之间：预告"即将开始第 N 遍"
      const step = stepAt(plan, landed.index);
      alertSeq += 1;
      return {
        seq: alertSeq,
        kind: 'repeatRest',
        stepTitle: step?.title ?? null,
        stepContent: `即将开始第 ${landed.repeat + 2} 遍`,
        sound: step?.alertSound ?? PHASE_SOUND.repeatRest,
        skippedPhases,
      };
    }
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
  /** 当前阶段结束时刻（epoch ms）。null = 未在计时（idle / paused / finished / 计次阶段）。 */
  runDeadline: number | null;
  /** 计次阶段（count 步骤的 step phase）的开始时刻，用于正数计时；其它情况为 null。 */
  phaseStartedAt: number | null;
  /** 暂停瞬间锁定的毫秒数：计时阶段是"剩余"，计次阶段是"已进行"，避免反复暂停累积秒级误差。 */
  pausedRemainingMs: number | null;
  /** 最近一次阶段切换提醒。音频 / 震动 / 横幅共用它作为触发源。 */
  alert: RunAlert | null;

  // ── actions ──────────────────────────────────────────
  loadPlans: () => Promise<void>;
  loadPlanById: (id: string) => Promise<Plan | null>;
  savePlan: (input: SavePlanInput) => Promise<Plan>;
  deletePlan: (id: string) => Promise<void>;
  /** 批量删除（多选删除 / 清空全部共用）。包含正在执行的链时先终止。 */
  deletePlans: (ids: string[]) => Promise<void>;
  /** 列表页拖拽排序后批量写入新顺序（已按新位置排列的完整 ids 数组）。 */
  reorderPlans: (orderedIds: string[]) => Promise<void>;

  startRun: (plan: Plan) => void;
  pauseRun: () => void;
  resumeRun: () => void;
  stopRun: () => void;
  clearRun: () => void;
  /** 计次步骤手动完成当前遍：推进到间隙 / 下一遍 / 停歇 / 下一步 / 完成。 */
  completeRep: () => void;
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
    if (state.run.status !== 'running' || state.activePlan === null) {
      return;
    }

    const plan = state.activePlan;

    // 计次阶段：没有 deadline，心跳只做正数计时，推进交给 completeRep()
    if (state.run.phase === 'step' && stepAt(plan, state.run.currentIndex)?.kind === 'count') {
      if (state.phaseStartedAt === null) {
        return;
      }
      const elapsedSec = Math.max(0, Math.floor((now - state.phaseStartedAt) / 1000));
      if (elapsedSec !== state.run.remainingSec) {
        set({ run: { ...state.run, remainingSec: elapsedSec } });
      }
      return;
    }

    if (state.runDeadline === null) {
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

    const result = advance(
      plan,
      state.run.currentIndex,
      state.run.repeatIndex,
      state.run.phase,
      state.runDeadline,
      now,
    );
    applyAdvance(plan, result, now, state.alert);
  }

  /** advance 的落点统一写库：同步心跳追帧与手动完成本遍共用。 */
  function applyAdvance(
    plan: Plan,
    result: AdvanceResult,
    now: number,
    currentAlert: RunAlert | null,
  ): void {
    const untimed = !result.finished && result.deadline === Number.POSITIVE_INFINITY;
    const remainingSec =
      result.finished || untimed ? 0 : Math.max(0, Math.ceil((result.deadline - now) / 1000));

    set({
      run: {
        planId: plan.id,
        status: result.finished ? 'finished' : 'running',
        currentIndex: result.index,
        repeatIndex: result.repeatIndex,
        remainingSec,
        phase: result.phase,
      },
      runDeadline: result.finished || untimed ? null : result.deadline,
      phaseStartedAt: untimed ? now : null,
      pausedRemainingMs: null,
      alert: alertFromTransitions(plan, result.transitions) ?? currentAlert,
    });
  }

  return {
    plans: [],
    listStatus: 'idle',
    listError: null,
    activePlan: null,
    run: INITIAL_RUN_STATE,
    runDeadline: null,
    phaseStartedAt: null,
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
      // reminder 字段可能变了（enabled / 时间 / repeat 模式）——刷新系统通知
      void notificationService.refreshAll();
      return saved;
    },

    deletePlan: async (id) => {
      const { run } = get();
      // 规格 E：删除正在执行的任务时必须先终止，否则计时器会指向一条不存在的链
      if (run.planId === id && run.status !== 'idle') {
        get().stopRun();
      }
      await planRepository.deletePlan(id);
      void notificationService.cancelOne(id);
      if (get().activePlan?.id === id) {
        set({ activePlan: null });
      }
      await get().loadPlans();
    },

    deletePlans: async (ids) => {
      if (ids.length === 0) {
        return;
      }
      const { run, activePlan } = get();
      // 与 deletePlan 同一规格：正在执行的那条在删除前必须先终止
      if (run.planId !== null && run.status !== 'idle' && ids.includes(run.planId)) {
        get().stopRun();
      }
      await planRepository.deletePlans(ids);
      for (const id of ids) {
        void notificationService.cancelOne(id);
      }
      if (activePlan !== null && ids.includes(activePlan.id)) {
        set({ activePlan: null });
      }
      await get().loadPlans();
    },

    reorderPlans: async (orderedIds) => {
      await planRepository.reorderPlans(orderedIds);
      // 乐观更新：立刻反映到 plans 数组，省一次 IO round-trip
      const current = get().plans;
      const byId = new Map(current.map((p) => [p.id, p]));
      const reordered: PlanSummary[] = orderedIds
        .map((id) => byId.get(id))
        .filter((p): p is PlanSummary => p !== undefined);
      if (reordered.length !== current.length) {
        // ids 不匹配，放弃乐观更新，直接重新加载
        await get().loadPlans();
      } else {
        set({ plans: reordered });
      }
    },

    startRun: (plan) => {
      const first = plan.steps[0];
      if (first === undefined) {
        // 没有步骤的链不允许执行（规格 E：没有步骤的任务不允许保存，这里是兜底）
        return;
      }
      const now = Date.now();
      const untimed = first.kind === 'count';
      set({
        activePlan: plan,
        run: {
          planId: plan.id,
          status: 'running',
          currentIndex: 0,
          repeatIndex: 0,
          remainingSec: untimed ? 0 : first.durationSec,
          phase: 'step',
        },
        runDeadline: untimed ? null : now + first.durationSec * 1000,
        phaseStartedAt: untimed ? now : null,
        pausedRemainingMs: null,
        // 第一步也要提醒，否则用户点进去后听不到任何反馈
        alert: stepAlert(plan, 0, 0),
      });
    },

    pauseRun: () => {
      const state = get();
      if (state.run.status !== 'running') {
        return;
      }
      // 计次阶段：锁定"已进行"毫秒，恢复时从 phaseStartedAt 继续正数计时
      if (state.runDeadline === null) {
        const plan = state.activePlan;
        if (
          plan === null ||
          state.run.phase !== 'step' ||
          stepAt(plan, state.run.currentIndex)?.kind !== 'count' ||
          state.phaseStartedAt === null
        ) {
          return;
        }
        const elapsedMs = Math.max(0, Date.now() - state.phaseStartedAt);
        set({
          run: {
            ...state.run,
            status: 'paused',
            remainingSec: Math.floor(elapsedMs / 1000),
          },
          phaseStartedAt: null,
          pausedRemainingMs: elapsedMs,
        });
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
      const bankMs = state.pausedRemainingMs;
      const plan = state.activePlan;
      const untimed =
        plan !== null &&
        state.run.phase === 'step' &&
        stepAt(plan, state.run.currentIndex)?.kind === 'count';
      // 计次阶段恢复：bankMs 是"已进行"，重新锚定 phaseStartedAt
      set({
        run: {
          ...state.run,
          status: 'running',
          remainingSec: Math.floor(bankMs / 1000),
        },
        runDeadline: untimed ? null : Date.now() + bankMs,
        phaseStartedAt: untimed ? Date.now() - bankMs : null,
        pausedRemainingMs: null,
      });
    },

    stopRun: () => {
      set({
        run: INITIAL_RUN_STATE,
        runDeadline: null,
        phaseStartedAt: null,
        pausedRemainingMs: null,
        alert: null,
      });
    },

    clearRun: () => {
      set({
        run: INITIAL_RUN_STATE,
        runDeadline: null,
        phaseStartedAt: null,
        pausedRemainingMs: null,
        alert: null,
        activePlan: null,
      });
    },

    completeRep: () => {
      const state = get();
      if (state.run.status !== 'running' || state.activePlan === null) {
        return;
      }
      const plan = state.activePlan;
      const current = stepAt(plan, state.run.currentIndex);
      // 只有计次步骤的计次阶段允许手动完成；计时阶段走自然 deadline
      if (state.run.phase !== 'step' || current?.kind !== 'count') {
        return;
      }
      const now = Date.now();
      // 把"现在"当作本遍的结束时刻喂给状态机，后续间隙/停歇从 now 起算
      const result = advance(plan, state.run.currentIndex, state.run.repeatIndex, 'step', now, now);
      applyAdvance(plan, result, now, state.alert);
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
