/**
 * 输入框：全 App 唯一的文本录入控件。
 *
 * 三种形态覆盖了本项目全部输入场景，避免出现"大标题输入框自己写一套、
 * 步骤标题又写一套"的分裂：
 * - `title`：无边框大字号，用于任务名称（类似 Apple 备忘录的标题）；
 * - `plain`：无边框中等字号，用于卡片内的步骤标题；
 * - `default`：带边框正文输入，用于多行内容与其它普通字段。
 *
 * 校验错误由上层以 `error` 传入，组件本身不做校验 —— 校验规则集中在
 * utils/plan.ts，组件只负责**把错误显示得清楚**。
 */

import { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { colors, layout, radius, spacing, typography } from '../theme';
import { AppText } from './AppText';

export type TextFieldVariant = 'title' | 'plain' | 'default';

export interface TextFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  variant?: TextFieldVariant;
  placeholder?: string;
  label?: string;
  /** 非空时进入错误态：边框变红并在下方给出原因。 */
  error?: string | null;
  hint?: string;
  multiline?: boolean;
  /** 多行输入的最小高度（行数）。 */
  minLines?: number;
  maxLength?: number;
  autoFocus?: boolean;
  editable?: boolean;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  onBlur?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TOP_PADDING = spacing.sm;

export function TextField({
  value,
  onChangeText,
  variant = 'default',
  placeholder,
  label,
  error,
  hint,
  multiline = false,
  minLines = 3,
  maxLength,
  autoFocus = false,
  editable = true,
  returnKeyType,
  onSubmitEditing,
  onBlur,
  style,
  testID,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const hasError = error !== null && error !== undefined;
  const borderless = variant !== 'default';

  return (
    <View style={[styles.container, style]}>
      {label === undefined ? null : (
        <AppText variant="captionStrong" color="textSecondary" style={styles.label}>
          {label}
        </AppText>
      )}

      <View
        style={[
          styles.field,
          borderless ? null : styles.bordered,
          borderless ? null : resolveBorder(hasError, focused),
          borderless ? null : styles.fieldPadding,
        ]}
      >
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          multiline={multiline}
          maxLength={maxLength}
          autoFocus={autoFocus}
          editable={editable}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          textAlignVertical={multiline ? 'top' : 'center'}
          style={[
            styles.input,
            typographyFor(variant),
            { color: editable ? colors.text : colors.textDisabled },
            multiline
              ? { minHeight: typography.body.lineHeight * minLines + TOP_PADDING * 2 }
              : styles.singleLine,
          ]}
        />
      </View>

      {hasError ? (
        <AppText variant="caption" color="danger" style={styles.helper}>
          {error}
        </AppText>
      ) : hint === undefined ? null : (
        <AppText variant="caption" color="textSecondary" style={styles.helper}>
          {hint}
        </AppText>
      )}
    </View>
  );
}

function typographyFor(variant: TextFieldVariant) {
  switch (variant) {
    case 'title':
      return typography.h1;
    case 'plain':
      return typography.title;
    case 'default':
      return typography.body;
  }
}

function resolveBorder(hasError: boolean, focused: boolean): StyleProp<ViewStyle> {
  if (hasError) {
    return { borderColor: colors.danger };
  }
  if (focused) {
    return { borderColor: colors.primary };
  }
  return { borderColor: colors.border };
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  label: {
    marginBottom: spacing.xs,
  },
  field: {
    borderRadius: radius.md,
    backgroundColor: colors.bg,
  },
  bordered: {
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  fieldPadding: {
    paddingHorizontal: spacing.md,
  },
  input: {
    padding: 0,
    margin: 0,
  },
  singleLine: {
    height: layout.minTouchTarget,
  },
  helper: {
    marginTop: spacing.xs,
  },
});
