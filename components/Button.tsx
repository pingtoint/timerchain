/**
 * 按钮：全 App 唯一的可点击主控件。
 *
 * 页面里不允许出现裸 `<Pressable>` + 背景色：按压态、禁用态、加载态、
 * 最小触控高度这些细节一旦各写各的，就会出现"这个按钮按下去有反馈、
 * 那个按钮按下去没反应"的不一致。
 */

import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, layout, radius, spacing } from '../theme';
import { AppText, type TextColorToken } from './AppText';
import { Icon, type IconColor, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** 前置图标。 */
  icon?: IconName;
  /** 撑满容器宽度。底部主操作按钮必须开启。 */
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const HEIGHT: Record<ButtonSize, number> = {
  sm: 36,
  md: layout.minTouchTarget,
  lg: 56,
};

const TEXT_VARIANT = {
  sm: 'captionStrong',
  md: 'bodyStrong',
  lg: 'bodyStrong',
} as const;

const H_PADDING: Record<ButtonSize, number> = {
  sm: spacing.md,
  md: spacing.lg,
  lg: spacing.lg,
};

interface VariantColors {
  background: string;
  backgroundPressed: string;
  foreground: TextColorToken;
  disabledBackground: string;
  disabledForeground: TextColorToken;
}

const VARIANT_COLORS: Record<ButtonVariant, VariantColors> = {
  primary: {
    background: colors.primary,
    backgroundPressed: colors.primaryPressed,
    foreground: 'textOnPrimary',
    disabledBackground: colors.primaryDisabled,
    disabledForeground: 'textOnPrimary',
  },
  secondary: {
    background: colors.bgSecondary,
    backgroundPressed: colors.bgSecondaryPressed,
    foreground: 'text',
    disabledBackground: colors.bgSecondary,
    disabledForeground: 'textDisabled',
  },
  danger: {
    background: colors.danger,
    backgroundPressed: colors.dangerPressed,
    foreground: 'textOnPrimary',
    disabledBackground: colors.dangerSoft,
    disabledForeground: 'textDisabled',
  },
  ghost: {
    background: 'transparent',
    backgroundPressed: colors.primarySoft,
    foreground: 'primary',
    disabledBackground: 'transparent',
    disabledForeground: 'textDisabled',
  },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  fullWidth = false,
  style,
  testID,
}: ButtonProps) {
  const palette = VARIANT_COLORS[variant];
  const inactive = disabled || loading;
  const foreground: TextColorToken = disabled ? palette.disabledForeground : palette.foreground;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: H_PADDING[size],
          backgroundColor: disabled
            ? palette.disabledBackground
            : pressed
              ? palette.backgroundPressed
              : palette.background,
        },
        fullWidth ? styles.fullWidth : null,
        style,
        pressed && !inactive ? styles.pressedScale : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors[foreground]} />
      ) : (
        <View style={styles.content}>
          {icon === undefined ? null : (
            <Icon name={icon} size={size === 'sm' ? 16 : 18} color={foreground as IconColor} />
          )}
          <AppText variant={TEXT_VARIANT[size]} color={foreground}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  /** 极轻微的下压反馈：这是"高级 vs 廉价"的分界线，不需要更多花招。 */
  pressedScale: {
    transform: [{ scale: 0.98 }],
  },
});
