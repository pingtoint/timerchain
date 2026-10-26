/**
 * 通知服务（expo-notifications）
 *
 * 职责：
 * 1. 管理系统通知权限
 * 2. 根据 DB 里 reminder_enabled 的任务，批量 schedule 系统通知
 * 3. 监听通知点击事件 → 打开 App → 匹配 plan → 打开执行页
 * 4. repeat 模式触发后自动推进下一次 schedule
 *
 * 策略：每条任务一个 notificationId（= plan.id），一对一绑定。
 * 相同时间戳 + 相同 notification_sound 的多条任务 soundName 相同，
 * 系统层面会自动归并播放一次提示音。
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { ReminderConfig } from '../types';
import { advanceRepeatAfterFire } from '../utils/calcNextFire';
import { listReminderPlans } from '../db';

/** 是否有权限。'granted' = 已经拿到；'denied' = 之前被拒绝；'null' = 从没问过。 */
export type PermissionStatus = 'granted' | 'denied' | 'null';

let _status: PermissionStatus | null = null;
let _listenerRegistered = false;

/** 初始化：请求权限 + 注册通知点击监听。App 启动时调用一次。 */
export async function initialize(): Promise<PermissionStatus> {
  // 请求系统权限（仅 Android 13+ 需要运行时请求；iOS 第一次 schedule 时自动弹）
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status !== 'granted') {
    const result = await Notifications.requestPermissionsAsync();
    _status = result.status === 'granted' ? 'granted' : 'denied';
  } else {
    _status = 'granted';
  }

  if (!_listenerRegistered) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    // 用户点击系统通知 → 推送通知到 JS 层；我们在 store 或页面里处理跳转
    Notifications.addNotificationResponseReceivedListener((response) => {
      const planId = response.notification.request.identifier;
      // 异步：不阻塞这个 listener
      void handleNotificationClicked(planId);
    });

    _listenerRegistered = true;
  }

  return _status;
}

/**
 * 打开提醒开关前调用：确保权限到手。
 * 返回 false = 用户拒绝过（部分国产 ROM 不弹系统框，需要引导去设置页手动开）。
 */
export async function ensurePermission(): Promise<boolean> {
  const status = await initialize();
  return status === 'granted';
}

/** 刷新全部提醒：cancelAll + 重新 schedule 所有 reminder_enabled 的任务。 */
export async function refreshAll(): Promise<void> {
  const status = await initialize();
  if (status !== 'granted') return;

  await Notifications.cancelAllScheduledNotificationsAsync();

  const plans = await listReminderPlans();
  // iOS 限制 64 条 pending notifications。先按 scheduled_for ASC 排，
  // 取"未来最近的 64 个"；过期的算出来但不 schedule（系统会忽略 past time）
  const valid = plans
    .map((p) => ({ plan: p, rem: p.reminder! }))
    .filter(({ rem }) => rem.scheduledFor !== null && rem.scheduledFor !== undefined)
    .sort((a, b) => (a.rem.scheduledFor! - b.rem.scheduledFor!))
    .slice(0, 64);

  for (const { plan, rem } of valid) {
    await scheduleOne(plan.id, plan.title, rem);
  }
}

/** 取消单条（用户删除任务、关闭提醒、改了时间后调用）。 */
export async function cancelOne(planId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(planId);
}

/** schedule 单条。notificationId = plan.id。 */
async function scheduleOne(
  planId: string,
  planTitle: string,
  rem: ReminderConfig,
): Promise<void> {
  if (rem.scheduledFor === null || rem.scheduledFor === undefined) return;
  if (rem.scheduledFor <= Date.now()) {
    // 已过期：系统会忽略，直接跳过
    return;
  }

  const fireDate = new Date(rem.scheduledFor);

  // soundName 策略：
  //   default → 用系统默认（不指定 sound）
  //   chime / beep / none → `${sound}_${yyyymmddhhmm}` 同时间戳同 sound 共享同一个名字
  //   系统层面自动合并：同 soundName + 同时间戳 → 只播一次提示音
  let soundName: string | undefined;
  if (rem.notificationSound && rem.notificationSound !== 'default' && rem.notificationSound !== 'none') {
    const pad = (n: number) => String(n).padStart(2, '0');
    const key = `${fireDate.getFullYear()}${pad(fireDate.getMonth() + 1)}${pad(fireDate.getDate())}${pad(fireDate.getHours())}${pad(fireDate.getMinutes())}`;
    soundName = `${rem.notificationSound}_${key}.caf`;
  }

  const repeatDesc = formatRepeatDescription(rem);
  const subtitle = repeatDesc ?? '定时提醒';

  await Notifications.scheduleNotificationAsync({
    identifier: planId, // 和 plan.id 一对一
    content: {
      title: planTitle,
      body: subtitle,
      sound: soundName ? (Platform.OS === 'android' ? undefined : soundName) : undefined,
      // Android 的自定义 sound 是从 res/raw 里取，我们不打包原生资源，所以 Android 走系统默认
      data: { planId },
    },
    trigger: {
      // DATE trigger（时间戳）跨端通用；CALENDAR 是 iOS 专属，Android 上会静默丢弃。
      // repeat 逻辑我们自己算（系统触发器不支持 weekly/monthly mask），所以这里永远是一次性。
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: rem.scheduledFor,
      // alarmClock = setAlarmClock()：国产 ROM 不会为省电延迟送达，状态栏显示闹钟图标。
      // app.json 已声明 SCHEDULE_EXACT_ALARM；提醒类语义正适合用闹钟级投递。
      delivery: 'alarmClock',
    },
  });
}

/** 用户点击通知 → 匹配 plan → 打开执行页 → 自动推进 repeat 到下一次。 */
async function handleNotificationClicked(planId: string): Promise<void> {
  // 这里我们只负责"推进 repeat"。路由跳转由 app 层订阅 Notifications 的全局事件处理。
  // 推进策略：
  //   once      → 不需要（已经触发了一次，不再 schedule）
  //   daily/weekly/monthly → 用 advanceRepeatAfterFire 算下一次 → 更新 DB → 重新 schedule 这一条
  try {
    // 延迟 1 秒等 DB 连接可用
    await new Promise((r) => setTimeout(r, 1000));
    const db = await import('../db');
    const plan = await db.getPlanById(planId);
    if (plan === null || plan.reminder === null || !plan.reminder.enabled) return;
    if (plan.reminder.repeatMode === 'once') return;

    const nextMs = advanceRepeatAfterFire(plan.reminder, Date.now());
    if (nextMs === null) return;

    // 更新 DB：scheduled_for 推进到下一次
    await db.savePlan({
      id: plan.id,
      title: plan.title,
      steps: plan.steps,
      reminder: { ...plan.reminder, scheduledFor: nextMs },
    });

    // 只重 schedule 这一条（cancel + 重新算）
    await cancelOne(planId);
    const updated = await db.getPlanById(planId);
    if (updated?.reminder) {
      await scheduleOne(updated.id, updated.title, updated.reminder);
    }
  } catch {
    // 失败静默：用户点完通知能进 App 就行，下一次 refreshAll 会把状态拉回来
  }
}

/** 把 ReminderConfig 格式化成"repeat 描述"，显示在通知 body 和 PlanCard 底行。 */
export function formatRepeatDescription(rem: ReminderConfig | null | undefined): string {
  if (!rem || !rem.enabled) return '';
  const tod = rem.timeOfDaySec ?? 0;
  const hours = Math.floor(tod / 3600);
  const mins = Math.floor((tod % 3600) / 60);
  const hhmm = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

  switch (rem.repeatMode) {
    case 'daily':
      return `每天 ${hhmm}`;
    case 'weekly': {
      const names = ['', '一', '二', '三', '四', '五', '六', '日'];
      const mask = new Set((rem.weeklyMask ?? '').split(',').map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n)));
      if (mask.size === 0) return `${hhmm}`;
      const sorted = Array.from(mask).sort((a, b) => a - b);
      return `周${sorted.map((d) => names[d] ?? '?').join('·')} ${hhmm}`;
    }
    case 'monthly':
      return `每月 ${rem.monthlyMask ?? ''} 号 ${hhmm}`;
    case 'once':
      if (rem.scheduledFor === null || rem.scheduledFor === undefined) return hhmm;
      return formatFireDate(rem.scheduledFor);
  }
}

/** scheduled_for → "今天 08:00" / "明天 08:00" / "周一 08:00" / "11月21日 08:00" / "已过期"。 */
export function formatFireDate(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '';
  const now = new Date();
  const fire = new Date(ms);
  const today00 = new Date(now); today00.setHours(0, 0, 0, 0);
  const fire00 = new Date(fire); fire00.setHours(0, 0, 0, 0);
  const diffDays = Math.round((fire00.getTime() - today00.getTime()) / 86_400_000);

  const hours = String(fire.getHours()).padStart(2, '0');
  const mins = String(fire.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${mins}`;

  if (diffDays < 0) return `已过期 ${fire.getMonth() + 1}月${fire.getDate()}日 ${timeStr}`;
  if (diffDays === 0) return `今天 ${timeStr}`;
  if (diffDays === 1) return `明天 ${timeStr}`;
  if (diffDays <= 7) {
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${names[fire.getDay()]} ${timeStr}`;
  }
  return `${fire.getMonth() + 1}月${fire.getDate()}日 ${timeStr}`;
}

export function scheduleOnePlan(planId: string): Promise<void> {
  // 把这条 plan 从 DB 读出来然后 schedule — 用 refreshAll 也可以但太重
  // 这里简单点：重新 listReminderPlans 然后只找 planId 那一条 schedule
  return refreshAll();
}
