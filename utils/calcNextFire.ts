/**
 * 根据 ReminderConfig 推算下一次触发的时间戳（epoch ms，本地时区）。
 *
 * 纯函数 —— 无副作用、无外部依赖、可单测。
 * 输入 ReminderConfig + now（可选，默认 Date.now()），输出下次应该 schedule 的时间点。
 * 如果算不出来（比如 targetDate 为空且 timeOfDaySec 为空），返回 null。
 */

import type { ReminderConfig } from '../types';

/** 一周的 ISO 编号：周一=1，周日=7。Date.getDay() 返回 0=周日，所以要转。 */
function isoWeekday(date: Date): number {
  const d = date.getDay(); // 0=周日
  return d === 0 ? 7 : d;
}

/** 解析 "1,2,3,4,5" 这种 mask 字符串成 Set<number>。空 / 非法返回空 Set。 */
function parseIntMask(mask: string | undefined | null): Set<number> {
  const result = new Set<number>();
  if (!mask) return result;
  for (const token of mask.split(',')) {
    const n = parseInt(token.trim(), 10);
    if (!Number.isNaN(n)) result.add(n);
  }
  return result;
}

/** 把 Date 设置到 timeOfDaySec 指定的本地时间。返回新 Date（不修改原对象）。 */
function setTimeOfDay(date: Date, sec: number): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setSeconds(sec);
  return d;
}

/** 给定一个日期，往前滚 N 天（保持 timeOfDay）。 */
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * 算出下一个"符合条件"的日期。从 fromDate 当天开始，最多往后探 366 天（极端：
 * monthly mask 只有 31 号 + 现在是 2 月 28 日 → 要探 337 天）。
 *
 * @param fromDate 起始日期（当天 00:00）；不算当天已经过了的时间
 * @param predicate 给定某天（当天 00:00），返回 true 表示这天符合条件
 * @returns 第一个符合条件的 Date（当天 00:00）；366 天内都没符合的返回 null
 */
function findNextDay(fromDate: Date, predicate: (day: Date) => boolean): Date | null {
  // 如果当天符合条件，就从当天开始（等下时间戳逻辑会处理"是否已过"）
  if (predicate(fromDate)) return fromDate;
  for (let i = 1; i <= 366; i += 1) {
    const candidate = addDays(fromDate, i);
    if (predicate(candidate)) return candidate;
  }
  return null;
}

export interface CalcResult {
  /** 下次触发时间戳（epoch ms，本地时区）。算不出来时为 null。 */
  fireAtMs: number | null;
  /**
   * 距离 now 过去还是未来。
   *   'future'  → fireAtMs 比 now 晚，可以直接 schedule
   *   'past'    → 比 now 早，说明用户设的是"已经过了的时间"（比如 daily 但现在已经 8 点多了），
   *               调用方应该推进到下一次（明天 / 下周一 / 下个月）
   */
  status: 'future' | 'past' | 'invalid';
}

export function calcNextFire(reminder: ReminderConfig, now: number = Date.now()): CalcResult {
  if (!reminder.enabled) {
    return { fireAtMs: null, status: 'invalid' };
  }

  const todSec = reminder.timeOfDaySec;
  if (todSec === undefined || todSec === null) {
    return { fireAtMs: null, status: 'invalid' };
  }
  if (todSec < 0 || todSec > 86400) {
    return { fireAtMs: null, status: 'invalid' };
  }

  const nowDate = new Date(now);
  const today00 = new Date(nowDate);
  today00.setHours(0, 0, 0, 0);

  let targetDay: Date | null = null;

  switch (reminder.repeatMode) {
    case 'once': {
      if (!(reminder.targetDate instanceof Date)) {
        return { fireAtMs: null, status: 'invalid' };
      }
      // 把用户选的 targetDate 当成目标日（忽略它的时间部分，只用 year/month/day）
      const d = new Date(reminder.targetDate);
      d.setHours(0, 0, 0, 0);
      targetDay = d;
      break;
    }

    case 'daily': {
      // 今天或明天
      targetDay = today00;
      break;
    }

    case 'weekly': {
      const mask = parseIntMask(reminder.weeklyMask);
      if (mask.size === 0) return { fireAtMs: null, status: 'invalid' };
      targetDay = findNextDay(today00, (day) => mask.has(isoWeekday(day)));
      break;
    }

    case 'monthly': {
      const mask = parseIntMask(reminder.monthlyMask);
      if (mask.size === 0) return { fireAtMs: null, status: 'invalid' };
      targetDay = findNextDay(today00, (day) => mask.has(day.getDate()));
      break;
    }

    default: {
      return { fireAtMs: null, status: 'invalid' };
    }
  }

  if (targetDay === null) {
    return { fireAtMs: null, status: 'invalid' };
  }

  // 构造"当天的 todSec 时刻"
  let fireAt = setTimeOfDay(targetDay, todSec);
  let status: CalcResult['status'];

  if (fireAt.getTime() > now) {
    status = 'future';
  } else if (reminder.repeatMode === 'once') {
    // once 模式：设的时间已经过了 — 过期，返回 past 让调用方显示灰色
    status = 'past';
  } else {
    // repeat 模式：今天的已经过了 → 推进到下一次
    const nextAdvance = findNextDay(addDays(targetDay, 1), (day) => {
      if (reminder.repeatMode === 'daily') return true;
      if (reminder.repeatMode === 'weekly') return parseIntMask(reminder.weeklyMask).has(isoWeekday(day));
      if (reminder.repeatMode === 'monthly') return parseIntMask(reminder.monthlyMask).has(day.getDate());
      return false;
    });
    if (nextAdvance === null) {
      return { fireAtMs: null, status: 'invalid' };
    }
    fireAt = setTimeOfDay(nextAdvance, todSec);
    status = 'future';
  }

  return { fireAtMs: fireAt.getTime(), status };
}

/** 给 repeat 模式的任务算"触发后应该推进到哪一天"。once 模式不需要调这个。 */
export function advanceRepeatAfterFire(
  reminder: ReminderConfig,
  firedAtMs: number,
): number | null {
  if (!reminder.enabled) return null;
  const firedAt = new Date(firedAtMs);
  const tomorrow00 = addDays(new Date(firedAt), 1);
  tomorrow00.setHours(0, 0, 0, 0);

  const next = calcNextFire(
    { ...reminder, repeatMode: reminder.repeatMode === 'once' ? 'daily' : reminder.repeatMode },
    firedAtMs, // 用刚刚触发的时间算 —— 已经过去了，calcNextFire 会自动推进
  );
  // calcNextFire 传 firedAtMs 而不是 now → 它会认为"刚过了一次"，对 repeat 模式会推进
  // 但 once 模式会返回 past。这里显式过滤掉 once：once 触发后不需要再 schedule
  if (reminder.repeatMode === 'once') return null;
  if (next.status !== 'future') return null;
  return next.fireAtMs;
}
