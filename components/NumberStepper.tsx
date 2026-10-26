/**
 * 小范围整数步进器：次数、间隙秒数这类"1、2、3……"密集取值的场景。
 *
 * 和 TimeStepper 的分工：TimeStepper 管"几十秒到几十分钟"的档位跳跃（梯子）；
 * NumberStepper 管 0~99 的连续整数，±1 逐次调整，点数值可直接手输。
 */

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

export interface NumberStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** 数值后的单位文案，如 "次" / "秒"。 */
  unit?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function NumberStepper({
  label,
  value,
  min,
  max,
  onChange,
  unit,
  disabled = false,
  style,
}: NumberStepperProps) {
  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && value < max;

  const [manual, setManual] = useState(false);
  const [text, setText] = useState('');

  const openManual = () => {
    if (disabled) {
      return;
    }
    setText(String(value));
    setManual(true);
  };

  const confirmManual = () => {
    const parsed = Number.parseInt(text, 10);
    if (!Number.isNaN(parsed)) {
      onChange(Math.max(min, Math.min(parsed, max)));
    }
    setManual(false);
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.row}>
        <AppText variant="captionStrong" color="textSecondary">
          {label}
        </AppText>

        <View style={styles.control}>
          <IconButton
            name="remove"
            accessibilityLabel={`减少${label}`}
            onPress={() => onChange(Math.max(min, value - 1))}
            variant="soft"
            size={32}
            iconSize={18}
            disabled={!canDecrease}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`手动输入${label}`}
            onPress={openManual}
            disabled={disabled}
            style={styles.valueBox}
          >
            <AppText variant="bodyStrong" tabular align="center" color={disabled ? 'textDisabled' : 'text'}>
              {unit === undefined ? String(value) : `${value} ${unit}`}
            </AppText>
          </Pressable>

          <IconButton
            name="add"
            accessibilityLabel={`增加${label}`}
            onPress={() => onChange(Math.min(max, value + 1))}
            variant="soft"
            size={32}
            iconSize={18}
            disabled={!canIncrease}
          />
        </View>
      </View>

      {manual ? (
        <View style={styles.manualRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType="number-pad"
            selectTextOnFocus
            autoFocus
            accessibilityLabel={label}
            style={styles.manualInput}
            maxLength={4}
          />
          {unit === undefined ? null : (
            <AppText variant="caption" color="textSecondary">
              {unit}
            </AppText>
          )}
          <IconButton
            name="checkmark"
            accessibilityLabel="确认"
            onPress={confirmManual}
            variant="soft"
            size={32}
            iconSize={18}
          />
          <IconButton
            name="close"
            accessibilityLabel="取消"
            onPress={() => setManual(false)}
            variant="plain"
            size={32}
            iconSize={18}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  valueBox: {
    minWidth: 64,
    paddingVertical: spacing.xs,
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  manualInput: {
    width: 72,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    textAlign: 'center',
    fontSize: 16,
  },
});
