/**
 * 后台运行保障引导。
 *
 * 问题背景：国产 ROM（华为/荣耀 EMUI、小米 MIUI 等）把"从最近任务划掉"实现为
 * 强制停止，系统会取消应用全部已排期闹钟，且默认电池策略会阻止应用被 AlarmManager
 * 唤醒。这是系统行为，闹钟级投递（alarmClock）也无法绕过。
 *
 * 代码能做的只有"引导"——Android 不允许应用自己进白名单：
 * 1. 电池优化白名单：系统弹窗一键允许（REQUEST_IGNORE_BATTERY_OPTIMIZATIONS）；
 * 2. 自启动 / 后台活动：厂商私有的"应用启动管理"没有公开 intent，只能文字指引。
 *
 * 引导只主动弹一次（SecureStore 记 flag），之后可从设置页「后台运行保障」再次进入。
 */

import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Alert, Platform } from 'react-native';

/**
 * expo-intent-launcher 不能静态 import：它的 JS 入口在求值时就向原生侧要模块，
 * 旧调试基座（没有打进这个原生模块的 APK）会在加载瞬间抛
 * "Cannot find native module"——所以必须调用时再 require，拿不到就降级为纯文字指引。
 */
interface IntentLauncherModule {
  startActivityAsync: (action: string, extra?: { data?: string }) => Promise<unknown>;
}

function loadIntentLauncher(): IntentLauncherModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-intent-launcher') as IntentLauncherModule;
  } catch {
    return null;
  }
}

const FLAG_KEY = 'guide.background.done';

const PACKAGE_NAME: string =
  (Constants.expoConfig?.android?.package as string | undefined) ?? 'com.timerchain.app';

async function hasShown(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    return (await SecureStore.getItemAsync(FLAG_KEY)) === '1';
  } catch {
    return false;
  }
}

async function markShown(): Promise<void> {
  try {
    await SecureStore.setItemAsync(FLAG_KEY, '1');
  } catch {
    // 记不上最多下次再弹一次，不阻塞主流程
  }
}

/** 打开"忽略电池优化"系统授权弹窗；失败则退回电池优化设置列表页。 */
async function openBatterySettings(): Promise<void> {
  const IntentLauncher = loadIntentLauncher();
  if (IntentLauncher === null) {
    // 旧基座没有这个原生模块：跳转不可用，对话框文字指引仍然成立
    return;
  }
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: `package:${PACKAGE_NAME}` },
    );
  } catch {
    try {
      await IntentLauncher.startActivityAsync(
        'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
      );
    } catch {
      // 极端情况：连设置页都打不开，只能让用户自己找，对话框文案已写明路径
    }
  }
}

/**
 * 弹出后台保障引导（仅此一次）。
 * 无论用户选哪个按钮都 resolve(true)：引导是建议而非门槛——
 * App 存活时提醒本来就能响，不该因为用户没配白名单就禁止开提醒。
 */
export function ensureBackgroundGuide(): Promise<void> {
  return (async () => {
    if (await hasShown()) return;
    await markShown();
    await showBackgroundGuideDialog();
  })();
}

/** 设置页「后台运行保障」入口：每次都展示。 */
export function showBackgroundGuideAgain(): Promise<void> {
  return showBackgroundGuideDialog();
}

function showBackgroundGuideDialog(): Promise<void> {
  return new Promise((resolve) => {
    Alert.alert(
      '后台运行保障',
      '为了让提醒在 App 关闭后也能准时送达，请完成两项系统设置（只需一次）：\n\n' +
        '1. 电池优化：点「去设置」，在弹出的系统对话框中选「允许」。\n\n' +
        '2. 自启动（华为/荣耀等国产机型）：系统设置 → 应用和服务 → 应用启动管理 → TimerChain → ' +
        '关闭「自动管理」，把「自启动 / 关联启动 / 后台活动」三项全部打开。\n\n' +
        '不设置的话，App 开着时提醒正常，被清理后可能不响。',
      [
        { text: '稍后', style: 'cancel', onPress: () => resolve() },
        {
          text: '去设置',
          onPress: () => {
            void openBatterySettings().finally(() => resolve());
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve() },
    );
  });
}
