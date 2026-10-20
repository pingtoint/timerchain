/**
 * 计时器驱动层。
 *
 * ── 职责边界 ───────────────────────────────────────────────────────
 * 这个 hook **只负责"什么时候去问一次时间"**，不负责计算剩余时间。
 * 真正的状态推进（阶段切换、剩余秒数）全部在 store 的 `tick()` 里，
 * 那里基于结束时间戳现算，因此：
 *
 * - 定时器丢帧、被系统降频、甚至完全没触发，都不会让倒计时变慢；
 * - `AppState` 回到前台时只需调一次 `reconcile()`，把跨过的阶段一次性推平。
 *
 * 换句话说，定时器的角色只是"刷新频率"，不是"计时精度来源"。
 * 所以即使原生后台模块不可用（Expo Go），降级成 JS 定时器也只是
 * 少了"后台提醒"，计时本身的正确性不受影响。
 *
 * ── 需要 Development Build ─────────────────────────────────────────
 * `@alimirzayev/react-native-background-timer` 是 Codegen/TurboModule 原生模块，
 * Expo Go 不含它。安装到真机需执行 `npx expo run:ios|android`
 * 或 `eas build --profile development`。
 */

import BackgroundTimer, {
  type TimerCapabilities,
} from '@alimirzayev/react-native-background-timer';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { TICK_INTERVAL_MS, usePlanStore } from '../store/planStore';

const BACKGROUND_EXECUTION_LABEL: Record<TimerCapabilities['backgroundExecution'], string> = {
  none: '切到后台后停止',
  'time-limited': '后台限时运行（iOS 系统限制）',
  'best-effort': '后台尽力运行（Android 可能被省电策略中断）',
};

export interface TimerSupport {
  /** 原生后台定时模块是否可用。Expo Go / Web 中为 false。 */
  nativeModuleAvailable: boolean;
  backgroundExecution: TimerCapabilities['backgroundExecution'];
  /** 直接展示给用户的说明文案，供设置页/关于页使用。 */
  summary: string;
}

/** 读取计时能力。设置页用它如实告知用户"后台到底靠不靠谱"。 */
export function describeTimerSupport(): TimerSupport {
  const capabilities = BackgroundTimer.getCapabilities();
  const label = BACKGROUND_EXECUTION_LABEL[capabilities.backgroundExecution];

  return {
    nativeModuleAvailable: capabilities.nativeModuleAvailable,
    backgroundExecution: capabilities.backgroundExecution,
    summary: capabilities.nativeModuleAvailable
      ? `原生后台计时已启用 · ${label}`
      : `未检测到原生模块（Expo Go / Web）· ${label}`,
  };
}

/**
 * 挂载计时心跳与前后台对账。
 * 建议在执行页调用；重复挂载是安全的（多次挂载只是心跳更密，不会算错时间）。
 */
export function useTimer(): void {
  const isRunning = usePlanStore((state) => state.run.status === 'running');

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const heartbeat = (): void => {
      usePlanStore.getState().tick();
    };

    // 先手动跑一次：从暂停恢复或刚进入执行页时，剩余时间立刻就是对的，
    // 不必等第一个心跳（否则会有最多 500ms 的显示延迟）。
    heartbeat();

    const useNativeModule = BackgroundTimer.isAvailable;
    let timerId: number;
    if (useNativeModule) {
      timerId = BackgroundTimer.setInterval(heartbeat, TICK_INTERVAL_MS);
    } else {
      // 降级路径：没有原生模块时用 JS 定时器。前台体验一致，区别只是切后台后
      // JS 会被系统挂起 —— 但回到前台时 reconcile() 会把时间补齐。
      timerId = setInterval(heartbeat, TICK_INTERVAL_MS) as unknown as number;
    }

    return () => {
      if (useNativeModule) {
        BackgroundTimer.clearInterval(timerId);
      } else {
        clearInterval(timerId);
      }
    };
  }, [isRunning]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        // 规格 A：回前台时按时间戳重新对账，而不是依赖定时器累积。
        usePlanStore.getState().reconcile();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);
}
