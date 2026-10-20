/**
 * Design System —— 唯一的设计令牌来源
 *
 * 规则（页面不得违反）：
 * 1. 颜色只能从 `colors` 取。整体只有 primary 一个主色，其余为系统语义色（成功/警告/危险）。
 *    `primarySoft` / `dangerSoft` 是 primary 与 danger 的低饱和底纹，属于同一色相，
 *    不属于"新增主色调"。
 * 2. 间距只能取 8pt 网格（4/8/16/24/32），不允许出现 13、18 这类随手数字。
 * 3. 圆角只能取 8/12/16/999。
 * 4. 页面不允许自己写 StyleSheet 与字面量，必须组合 components/ 下的基础组件。
 */

import type { TextStyle, ViewStyle } from 'react-native';

export const colors = {
  /** 唯一主色。全 App 只允许这一个强调色。 */
  primary: '#2C6BED',
  /** 主色按压态：同色相加深，不是第二种颜色。 */
  primaryPressed: '#1F55C9',
  /** 主色 8% 底纹，用于极轻量的选中底色。 */
  primarySoft: '#EDF3FE',
  primaryDisabled: '#B7CBF7',

  success: '#34C759',
  warning: '#FF9F0A',
  danger: '#FF3B30',
  dangerPressed: '#D92D22',
  dangerSoft: '#FEEDEC',

  bg: '#FFFFFF',
  bgSecondary: '#F5F5F7',
  /** bgSecondary 的按压态：同色相加深一档，用于次要按钮。 */
  bgSecondaryPressed: '#EBEBF0',
  bgElevated: '#FFFFFF',

  text: '#1C1C1E',
  textSecondary: '#8E8E93',
  textOnPrimary: '#FFFFFF',
  /** 仅用于禁用态文字，与 textSecondary 区分开。 */
  textDisabled: '#C7C7CC',

  border: '#E5E5EA',
  /** 极轻分隔线，用于卡内部分隔（比 border 更弱）。 */
  hairline: '#EFEFF2',

  /** 模态遮罩。Dialog 背后压暗用，不可用作任何前景色。 */
  overlay: 'rgba(0, 0, 0, 0.4)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * 字阶。H1/H2/正文/辅助 四档为规格要求，其余（display/title/overline）
 * 是同级派生，用于倒计时大数字、导航栏标题与徽标。
 */
export const typography = {
  /** 执行页倒计时，必须配合 tabular-nums 使用。 */
  display: { fontSize: 64, lineHeight: 68, fontWeight: '700' },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  captionStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
} as const satisfies Record<string, TextStyle>;

/** 字号 → 语义名，供 AppText 使用。 */
export type TypographyVariant = keyof typeof typography;

/**
 * 层级阴影。只有三档，且刻意很淡 —— 精致感来自层次，不是深投影。
 * `dragging` 是三档里唯一"明显"的，用于拖拽中的卡片抬升反馈。
 */
export const shadow = {
  none: {},
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  dragging: {
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 14,
  },
} as const satisfies Record<string, ViewStyle>;

/** 动效时长（毫秒）。只允许用这几档，避免各处各写一个数字。 */
export const motion = {
  fast: 120,
  /** 步骤切换淡入淡出时长，规格指定 200ms。 */
  base: 200,
  slow: 320,
  /** 顶部横幅停留时长。 */
  bannerVisibleMs: 3000,
} as const;

export const layout = {
  /** 屏幕左右安全内边距。 */
  screenPadding: spacing.md,
  /** 触控目标最小高度（Apple HIG 建议 44）。 */
  minTouchTarget: 44,
  /** 正文最大阅读宽度，平板/iPad 上避免行宽过长。 */
  contentMaxWidth: 560,
} as const;

/** 拖拽排序时的缩放反馈。 */
export const dragFeedback = {
  scale: 1.03,
} as const;

export const theme = {
  colors,
  spacing,
  radius,
  typography,
  shadow,
  motion,
  layout,
  dragFeedback,
} as const;
