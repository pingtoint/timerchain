/**
 * 纯工具函数（格式化 + 错误归一化）。无副作用、不依赖 React，
 * 方便在组件、store、数据层之间复用。
 */

/** 夹取到区间内，用于选择器与校验。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * 倒计时显示：05:12，超过 1 小时用 1:05:12。
 * 始终返回定宽字符，配合 tabular-nums 保证数字跳动时不发生水平位移。
 */
export function formatClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

/** 选择器里的紧凑读数：45 秒 / 1 分 30 秒 / 12 分。 */
export function formatLength(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  if (safe === 0) {
    return '0 秒';
  }
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  if (minutes === 0) {
    return `${seconds} 秒`;
  }
  if (seconds === 0) {
    return `${minutes} 分`;
  }
  return `${minutes} 分 ${seconds} 秒`;
}

/** 人类可读的时长：约 12 分钟 / 约 1 小时 5 分钟 / 50 秒。 */
export function formatApproxDuration(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.round((safe % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  }
  if (safe < 60) {
    return `${safe} 秒`;
  }
  return `${Math.max(1, minutes)} 分钟`;
}

/** 列表卡片副标题："3 步 · 约 12 分钟"。 */
export function formatPlanMeta(stepCount: number, totalDurationSec: number): string {
  const stepLabel = `${stepCount} 步`;
  if (totalDurationSec <= 0) {
    return stepLabel;
  }
  return `${stepLabel} · 约 ${formatApproxDuration(totalDurationSec)}`;
}

/** 步骤计数："步骤 2/5"。 */
export function formatStepCounter(current: number, total: number): string {
  return `步骤 ${current}/${total}`;
}

/**
 * 把抛出物归一化成可以展示给用户的一句话。
 *
 * JS 里 catch 到的东西**不一定是 Error**（可能是字符串、甚至 null），
 * 所以这里必须显式收窄，而不是直接 `.message`。
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return '发生未知错误，请重试';
}
