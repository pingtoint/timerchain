/**
 * 图标是 Design System 的一部分，集中一层薄封装。
 *
 * 直接在各处 `import Ionicons from '@expo/vector-icons/Ionicons'` 的问题有两个：
 * 1. 图标的字号/颜色会散落在各个组件里，无法统一；
 * 2. `keyof typeof Ionicons.glyphMap` 这种类型写法会在十几个文件里重复。
 */

import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../theme';

/** 可用图标名。传入不存在的名字会在编译期报错，而不是运行时静默不显示。 */
export type IconName = keyof typeof Ionicons.glyphMap;

/** 只能使用主题色，避免组件里出现裸色值。 */
export type IconColor =
  | 'text'
  | 'textSecondary'
  | 'textDisabled'
  | 'textOnPrimary'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger';

export interface IconProps {
  name: IconName;
  /** 视觉尺寸。默认 20，与正文 16px 搭配视觉重量相当。 */
  size?: number;
  color?: IconColor;
}

export function Icon({ name, size = 20, color = 'text' }: IconProps) {
  return <Ionicons name={name} size={size} color={colors[color]} />;
}
