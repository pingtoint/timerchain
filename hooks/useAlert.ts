/**
 * 提醒层：音频播放 + 震动反馈 + 与计时状态机的接线。
 *
 * ── 两个刻意的工程决策，与规格原文不同，理由如下 ──────────────────────
 *
 * 1) **播放器建在模块作用域（createAudioPlayer），而不是在组件里用 useAudioPlayer()**
 *    `useAudioPlayer()` 会在组件卸载时自动释放播放器。提醒音是"无论用户此刻在哪一屏
 *    都必须能响"的全局副作用，把它的生命周期绑到某个页面组件上是错的架构 ——
 *    例如将来在执行页之外（后台回到前台的第一帧）也需要发声，就会静音。
 *    `createAudioPlayer` 提供稳定的应用级播放器，配合 `preload()` 让首声提醒不用等解码。
 *
 * 2) **懒创建**：不在模块加载时立刻建播放器。模块级 `createAudioPlayer` 若在原生模块
 *    缺失（如 Expo Web、未装 Dev Client）时抛错，会直接把整个 bundle 拖垮 ——
 *    而"没声音"不应该是一个致命错误。
 *
 * ── 需要 Development Build ─────────────────────────────────────────
 * expo-audio 是原生模块，Expo Go 里表现受限（尤其是后台播放）。
 * 完整行为需要 `npx expo run:ios|android` 或 `eas build --profile development`。
 */

import { createAudioPlayer, preload, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef } from 'react';

import beepSource from '../assets/sounds/beep.mp3';
import chimeSource from '../assets/sounds/chime.mp3';
import { usePlanStore } from '../store/planStore';
import type { AlertSound, RunAlertKind } from '../types';

interface SoundPlayers {
  chime: AudioPlayer;
  beep: AudioPlayer;
}

let players: SoundPlayers | null = null;

function getPlayers(): SoundPlayers {
  if (players === null) {
    players = {
      chime: createAudioPlayer(chimeSource),
      beep: createAudioPlayer(beepSource),
    };
    // fire-and-forget：预加载只是优化首声延迟，失败也无所谓
    void preload(chimeSource).catch(() => undefined);
    void preload(beepSource).catch(() => undefined);
  }
  return players;
}

/**
 * 配置全局音频会话。在根布局调用一次。
 *
 * 关于静音开关（规格 C「默认遵循系统静音，不强制播放」）：
 * `playsInSilentMode: false` 意味着**系统静音拨片打开时提醒音不响**。
 * 这对一个计时工具是个真实取舍：好处是不打扰周围人、尊重用户设定，
 * 代价是"到点了没听见"。震动不受静音拨片影响，所以每步提醒都同时给触感反馈，
 * 作为听不到声音时的兜底。想反过来（静音下也强制出声），把这一项改成 true 即可。
 */
export async function configureAudioSession(): Promise<void> {
  try {
    await setAudioModeAsync({
      playsInSilentMode: false,
      // 提醒音属于音效，不该抢断用户正在放的音乐/播客
      interruptionMode: 'mixWithOthers',
      // 计时器切到后台后仍然要能提醒
      shouldPlayInBackground: true,
    });
  } catch {
    // 音频会话配置失败不应阻断 App 启动（Web / 缺少原生模块时会走到这里）
  }
}

async function replay(player: AudioPlayer): Promise<void> {
  if (!player.isLoaded) {
    // createAudioPlayer 的解码是异步的，首帧可能还没就绪。
    // 这里用一次短延时重试，避免"第一条提醒恰好没声音"这种最影响信任感的 bug。
    // 注意：这是 UI 侧的一次性等待，与倒计时的定时器无关（倒计时严格基于时间戳）。
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 80);
    });
  }
  await player.seekTo(0);
  player.play();
}

/**
 * 播放提醒音。`none` 表示该步骤关掉了声音（规格允许），此时直接返回，
 * 但文字横幅与震动仍然照常，反馈不会缺失。
 */
export async function playAlertSound(sound: AlertSound): Promise<void> {
  if (sound === 'none') {
    return;
  }
  try {
    await replay(getPlayers()[sound]);
  } catch {
    // 播放失败静默放弃：提醒音不值得影响计时正确性
  }
}

/** 按阶段给出不同的触感，让用户闭着眼也能分辨"开始下一步"和"该休息了"。 */
export function playAlertHaptics(kind: RunAlertKind): void {
  const fire = (): Promise<void> => {
    switch (kind) {
      case 'step':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      case 'rest':
      case 'repeatRest':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      case 'finished':
        // 规格 B：全部完成时给一个明确的成功触感
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };
  void fire().catch(() => undefined);
}

/**
 * 提醒总线：监听最新的 RunAlert，播放声音并震动。
 *
 * 挂在根布局而不是执行页 —— 提醒是全局副作用，不该依赖"某个页面恰好处于挂载状态"。
 * 横幅由 Banner 组件消费同一份 store 数据，两者不会不同步。
 */
export function useRunAlerts(): void {
  const alert = usePlanStore((state) => state.alert);
  /** 记住已经播报过的序号，避免 store 因别的原因重渲染时把同一提醒播两遍。 */
  const playedSeq = useRef(0);

  useEffect(() => {
    if (alert === null || alert.seq === playedSeq.current) {
      return;
    }
    playedSeq.current = alert.seq;
    void playAlertSound(alert.sound);
    playAlertHaptics(alert.kind);
  }, [alert]);
}

/** 编辑页试听提醒音用。返回的函数引用稳定，可作为依赖直接放进依赖数组。 */
export function useAlertSoundPreview(): (sound: AlertSound) => void {
  return useCallback((sound: AlertSound) => {
    void playAlertSound(sound);
    playAlertHaptics('step');
  }, []);
}
