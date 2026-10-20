/**
 * 图标按钮：导航栏动作、加减号、关闭按钮等。
 *
 * 与 Button 分开的原因：图标按钮是**正方形触控区**且通常不带文字，
 * 复用 Button 需要传一堆只为绕过文字的样式覆盖，反而更容易出不一致。
 */

import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors, layout, radius, spacing } from '../theme';
import { Icon, type IconColor, type IconName } from './Icon';

export type IconButtonVariant = 'plain' | 'soft' | 'filled';
export type IconButtonTone = 'default' | 'primary' | 'danger';

export interface IconButtonProps {
  name: IconName;
  onPress: () => void;
  /** 无障碍标签。图标按钮没有文字，必须提供，否则读屏软件只会念出"按钮"。 */
  accessibilityLabel: string;
  variant?: IconButtonVariant;
  tone?: IconButtonTone;
  size?: number;
  iconSize?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TONE_FOREGROUND: Record<IconButtonTone, IconColor> = {
  default: 'text',
  primary: 'primary',
  danger: 'danger',
};

export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  variant = 'plain',
  tone = 'default',
  size = layout.minTouchTarget,
  iconSize,
  disabled = false,
  style,
  testID,
}: IconButtonProps) {
  const foreground: IconColor = disabled ? 'textDisabled' : TONE_FOREGROUND[tone];

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      hitSlop={spacing.sm}
      style={({ pressed }) => [
        styles.base,
        {
          width: size,
          height: size,
          backgroundColor: resolveBackground(variant, tone, pressed, disabled),
        },
        style,
      ]}
    >
      <Icon name={name} size={iconSize ?? Math.round(size * 0.5)} color={foreground} />
    </Pressable>
  );
}

function resolveBackground(
  variant: IconButtonVariant,
  tone: IconButtonTone,
  pressed: boolean,
  disabled: boolean,
): string {
  if (disabled) {
    return 'transparent';
  }
  if (variant === 'filled') {
    if (tone === 'danger') {
      return pressed ? colors.dangerPressed : colors.danger;
    }
    if (tone === 'primary') {
      return pressed ? colors.primaryPressed : colors.primary;
    }
    return pressed ? colors.bgSecondaryPressed : colors.bgSecondary;
  }
  if (variant === 'soft') {
    if (tone === 'danger') {
      return colors.dangerSoft;
    }
    return pressed ? colors.primarySoft : colors.bgSecondary;
  }
  return pressed ? colors.bgSecondary : 'transparent';
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
});
