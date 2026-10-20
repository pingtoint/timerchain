/**
 * 分隔线。默认是发丝级（比 1px 更轻），只在需要"分组"语义时使用；
 * 列表中相邻卡片之间用间距分隔，不要加线 —— 那会立刻变成表格而不是卡片流。
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, spacing } from '../theme';

export interface DividerProps {
  /** 上下留白。`none` 用于卡内紧跟文字的分隔。 */
  spacingY?: 'none' | 'sm' | 'md';
  inset?: number;
  style?: StyleProp<ViewStyle>;
}

const SPACING_Y: Record<NonNullable<DividerProps['spacingY']>, number> = {
  none: 0,
  sm: spacing.sm,
  md: spacing.md,
};

export function Divider({ spacingY = 'none', inset = 0, style }: DividerProps) {
  return (
    <View
      style={[
        styles.base,
        { marginVertical: SPACING_Y[spacingY], marginLeft: inset },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
  },
});
