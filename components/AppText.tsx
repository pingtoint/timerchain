/**
 * 统一的文字组件。
 *
 * 页面里不允许出现裸 `<Text>` 或手写字号：所有文字都必须经过 AppText，
 * 这样字阶（H1/H2/正文/辅助）只有一个来源，改一次全局生效。
 */

import { Text, type TextProps } from 'react-native';

import { colors, typography, type TypographyVariant } from '../theme';

export type TextColorToken =
  | 'text'
  | 'textSecondary'
  | 'textDisabled'
  | 'textOnPrimary'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger';

export interface AppTextProps extends TextProps {
  /** 字阶。默认正文。 */
  variant?: TypographyVariant;
  color?: TextColorToken;
  /**
   * 等宽数字。倒计时、时长读数**必须**开启：
   * 否则 "09:59" → "09:58" 这类变化会让文字宽度跳动，整行跟着抖。
   */
  tabular?: boolean;
  align?: 'left' | 'center' | 'right';
}

export function AppText({
  variant = 'body',
  color = 'text',
  tabular = false,
  align,
  style,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[
        typography[variant],
        { color: colors[color] },
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        align === undefined ? null : { textAlign: align },
        style,
      ]}
    />
  );
}
