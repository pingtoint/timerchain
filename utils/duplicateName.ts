/**
 * 任务重名检测与改名建议（导入页专用）。
 *
 * 规则：去首尾空格 + 忽略大小写后完全一致即视为重名 —— 中文场景大小写
 * 影响极小，但对英文任务名（"Morning Run" vs "morning run"）用户感知是同一个。
 *
 * 只拦导入路径：编辑页手动改名不做唯一性限制（自己改自己的不拦）。
 */

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

export function isDuplicateTitle(title: string, existingTitles: readonly string[]): boolean {
  const target = normalizeTitle(title);
  if (target.length === 0) {
    return false;
  }
  return existingTitles.some((existing) => normalizeTitle(existing) === target);
}

/**
 * 自动改名建议："做饭" → "做饭 (2)"；(2) 也被占用则顺延 (3)、(4)…
 * 这是文件管理器 / 网盘 / 微信收藏的通用惯例，用户零学习成本。
 */
export function suggestUniqueTitle(title: string, existingTitles: readonly string[]): string {
  const trimmed = title.trim();
  const taken = new Set(existingTitles.map(normalizeTitle));
  if (!taken.has(normalizeTitle(trimmed))) {
    return trimmed;
  }
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${trimmed} (${n})`;
    if (!taken.has(normalizeTitle(candidate))) {
      return candidate;
    }
  }
  // 99 个同名还撞车理论上到不了，用时间戳兜底保证能存
  return `${trimmed} (${Date.now() % 1000})`;
}
