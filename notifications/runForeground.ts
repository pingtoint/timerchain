/**
 * 任务执行的前台服务通知（美团外卖"骑手状态"同款机制）。
 *
 * ── 为什么要前台服务 ─────────────────────────────────────────────
 * App 切后台 / 灭屏后，RN 的 JS 定时器会被冻结，执行进度没人播报，
 * 用户也失去控制。Android 的 Foreground Service 让任务以"系统认可
 * 的进行中"状态常驻：通知栏常驻卡片 + 锁屏可见 + 系统级走字倒计时，
 * 计时状态机（planStore）本身不依赖它运行，它只负责"显示 + 遥控"。
 *
 * ── 与 planStore 的关系 ─────────────────────────────────────────
 * 这里**主动订阅** store（store 不 import 本模块，避免循环依赖）：
 *  - run 状态机每次跨阶段（步骤/遍/停歇/暂停/结束）→ 刷新通知内容；
 *  - 通知按钮（暂停/继续/终止）→ 直接调用 store 的 action。
 * store 的 500ms tick 只改 remainingSec，被快照比对挡住，不会刷通知。
 *
 * ── 倒计时走字 ─────────────────────────────────────────────────
 * showChronometer + timestamp(截止时刻) + chronometerDirection:'down'
 * 由系统渲染，每秒跳动零 JS 开销 —— 计时结束后再统一对时。
 */

import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidStyle,
  EventType,
  type Notification,
} from '@notifee/react-native';

import type { Plan, RunPhase, RunState } from '../types';
import { usePlanStore } from '../store/planStore';
import { colors } from '../theme';

const NOTIFICATION_ID = 'run-fgs';
const CHANNEL_ID = 'run-progress';

/** 是否已把前台服务拉起来（避免重复 start / 无谓的 stop）。 */
let serviceRunning = false;
/** 上次刷通知时的状态快照，tick 产生的高频 set 靠它挡掉。 */
let lastSnapshot = '';

function fmt(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** 当前阶段的总时长（秒），算进度条用；计次阶段返回 null。 */
function phaseTotalSec(plan: Plan, run: RunState): number | null {
  const step = plan.steps[run.currentIndex];
  if (step === undefined) return null;
  if (run.phase === 'step') return step.kind === 'count' ? null : step.durationSec;
  if (run.phase === 'rest') return step.restAfterSec;
  if (run.phase === 'repeatRest') return step.repeatRestSec;
  return null;
}

function phaseBody(plan: Plan, run: RunState): string {
  const step = plan.steps[run.currentIndex];
  if (step === undefined) return '执行中';
  const pos = `步骤 ${run.currentIndex + 1}/${plan.steps.length}`;

  if (run.phase === 'rest') {
    const next = plan.steps[run.currentIndex + 1];
    return `停歇 · 下一步：${next !== undefined && next.title !== '' ? next.title : '待命'}`;
  }
  if (run.phase === 'repeatRest') {
    return `间隙 · 即将开始第 ${run.repeatIndex + 2} 遍`;
  }
  // step 阶段
  const repeatPart =
    step.repeatCount > 1 ? ` · 第 ${run.repeatIndex + 1}/${step.repeatCount} 遍` : '';
  const manualPart = step.kind === 'count' ? ' · 做完回 App 点完成' : '';
  const title = step.title === '' ? '' : ` · ${step.title}`;
  return `${pos}${repeatPart}${title}${manualPart}`;
}

/** 组装通知体。paused 时 deadline 无意义，走静态文本。 */
function buildNotification(plan: Plan, run: RunState, runDeadline: number | null) {
  const paused = run.status === 'paused';
  const total = phaseTotalSec(plan, run);
  const remaining = paused ? (usePlanStore.getState().pausedRemainingMs ?? 0) / 1000 : run.remainingSec;

  const body = paused
    ? `已暂停 · 剩余 ${fmt(remaining)}`
    : phaseBody(plan, run);

  return {
    id: NOTIFICATION_ID,
    title: plan.title,
    body,
    android: {
      channelId: CHANNEL_ID,
      asForegroundService: true,
      ongoing: true,
      smallIcon: 'ic_launcher',
      color: colors.primary,
      // HIGH 强制展开态，确保按钮在华为 EMUI 上也能直接显示
      importance: AndroidImportance.HIGH,
      // alarm 类别强制系统展开通知（华为默认折叠 FGS 通知）
      category: AndroidCategory.ALARM,
      // 点击通知主体 → Notifee 默认行为就是拉起 MainActivity
      pressAction: { id: 'default' },
      // 系统级倒计时：只在运行中的计时阶段显示走字
      ...(runDeadline !== null && !paused && run.phase === 'step'
        ? {
            showChronometer: true,
            chronometerDirection: 'down' as const,
            timestamp: runDeadline,
          }
        : {}),
      ...(total !== null
        ? { progress: { max: total, current: Math.max(0, Math.min(total, total - Math.max(0, remaining))) } }
        : {}),
      // BigText style → 强制通知默认展开，按钮直接可见（华为 EMUI 默认折叠 FGS 通知）
      style: { type: AndroidStyle.BIGTEXT as const, text: body },
      actions: [
        paused
          ? { title: '继续', pressAction: { id: 'resume' } }
          : { title: '暂停', pressAction: { id: 'pause' } },
        { title: '终止', pressAction: { id: 'stop' } },
      ],
    },
  };
}

async function showRunNotification(state: ReturnType<typeof usePlanStore.getState>): Promise<void> {
  const plan = state.activePlan;
  const run = state.run;
  if (plan === null) return;

  await notifee.displayNotification(buildNotification(plan, run, state.runDeadline));
}

async function handleStoreChange(state: ReturnType<typeof usePlanStore.getState>): Promise<void> {
  const run = state.run;
  const plan = state.activePlan;

  // 粗筛：完全不在执行 → 撤服务 / 直接跳过
  if (plan === null || run.status === 'idle' || run.status === 'finished') {
    if (serviceRunning) {
      serviceRunning = false;
      lastSnapshot = '';
      await notifee.stopForegroundService();
    }
    return;
  }

  const snapshot = [
    plan.id,
    plan.title,
    run.status,
    run.currentIndex,
    run.repeatIndex,
    run.phase,
    state.runDeadline,
    state.pausedRemainingMs !== null ? 'p' : 'r',
  ].join('|');

  if (snapshot === lastSnapshot) return; // tick 噪声 + 无关 action（savePlan 改另一条链），忽略
  lastSnapshot = snapshot;

  if (!serviceRunning) {
    serviceRunning = true;
  }
  await showRunNotification(state);
}

/** 通知按钮 → store action。JS 进程被前台服务保活，后台也能收到。 */
async function handleAction(actionId: string): Promise<void> {
  const store = usePlanStore.getState();
  if (actionId === 'pause') store.pauseRun();
  else if (actionId === 'resume') store.resumeRun();
  else if (actionId === 'stop') store.stopRun();
}

async function handleEvent(event: {
  type: EventType;
  detail: { pressAction?: { id?: string } };
}): Promise<void> {
  if (event.type !== EventType.ACTION_PRESS) return;
  const id = event.detail.pressAction?.id;
  if (id === 'pause' || id === 'resume' || id === 'stop') {
    void handleAction(id);
  } else if (id === 'default') {
    // Notifee 默认行为已拉起 MainActivity，这里显式调用 router 确保回到执行页
    try {
      const { router } = await import('expo-router');
      router.navigate('/run');
    } catch {
      // ignore — App 可能正在启动中
    }
  }
}

/**
 * 入口注册（index.js 在 expo-router 之前 import 本模块）：
 * 1. 前台服务 runner —— 永不 resolve 的 promise，stopForegroundService 才结束；
 * 2. 前台 / 后台事件监听 —— 通知按钮的按下事件。
 * 3. store 订阅 —— 状态机变化驱动通知刷新。
 */
export function registerRunForeground(): void {
  notifee.registerForegroundService((_notification: Notification) => new Promise<void>(() => {}));

  notifee.onForegroundEvent(handleEvent);
  notifee.onBackgroundEvent(handleEvent);

  // 先删旧通道（Android 不允许修改已存在通道的 importance），重建 HIGH 级别
  void notifee.deleteChannel(CHANNEL_ID).then(() =>
    notifee.createChannel({
      id: CHANNEL_ID,
      name: '任务执行中',
      importance: AndroidImportance.HIGH,
      vibration: false,
    }),
  );

  usePlanStore.subscribe((state) => {
    void handleStoreChange(state);
  });
}
