/**
 * 卡片：全 App 唯一的分组容器。
 *
 * 精致感的来源是"留白 + 层次"，所以卡片只有两种形态：
 * - `surface`（默认）：白底 + 极淡阴影，用于浮在 bgSecondary 上的内容；
 * - `flat`：白底 + 发丝边框，用于本身就是白底页面里的分组（避免阴影叠加发灰）。
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow, spacing } from '../theme';

export type CardVariant = 'surface' | 'flat';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  padding?: CardPadding;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const PADDING: Record<CardPadding, number> = {
  none: 0,
  sm: spacing.sm,
  md: spacing.md,
  lg: spacing.lg,
};

export function Card({
  children,
  variant = 'surface',
  padding = 'md',
  style,
  testID,
}: CardProps) {
  return (
    <View testID={testID} style={[styles.base, baseVariantStyle(variant), { padding: PADDING[padding] }, style]}>
      {children}
    </View>
  );
}

function baseVariantStyle(variant: CardVariant): StyleProp<ViewStyle> {
  return variant === 'surface'
    ? [styles.surface, shadow.card]
    : styles.flat;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
  },
  surface: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  flat: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
