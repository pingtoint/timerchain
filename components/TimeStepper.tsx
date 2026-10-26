/**
 * 时长选择器（± 档位步进）。
 *
 * ── 为什么用"档位梯子"而不是固定步长 ──────────────────────────────
 * 需求区间是 10 秒 ~ 60 分钟，跨了两个数量级。若固定步长：
 * - 用 10 秒档 → 从 5 分钟调到 60 分钟要按 330 次；
 * - 用 60 秒档 → 永远选不到 10 秒、45 秒这类短时长。
 *
 * 因此这里把可选值定义成一条**离散梯子**：小值区间档位密（10/15/20/30/45 秒），
 * 大值区间档位疏（15/20/30/45/60 分钟）。± 就是在梯子上移动到相邻一格。
 * 用户不必理解步长，只需要知道"往上是大、往下是小"，而且每一格都落在
 * 一个"人会觉得自然"的时刻上。
 *
 * 若当前值不在梯子上（例如从旧版本库里读出的 137 秒），会朝着移动方向
 * 吸附到最近的梯子档位，而不是先归零再走 —— 这样不会出现"点一下变成 0"。
 */

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { formatLength } from '../utils/format';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

export interface TimeStepperProps {
  label: string;
  value: number;
  onChange: (next: number) => void;
  /** 允许的离散档位，必须升序。 */
  ladder: readonly number[];
  /** 值为 0 时的显示文案（停歇时长用"无停歇"比"0 秒"更自然）。 */
  zeroLabel?: string;
  hint?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** 0 值也视为合法档位；梯子本身不需要包含 0。 */
function resolveLadder(ladder: readonly number[], zeroLabel: string | undefined): number[] {
  if (zeroLabel === undefined || ladder.length === 0 || ladder[0] === 0) {
    return [...ladder];
  }
  return [0, ...ladder];
}

export function TimeStepper({
  label,
  value,
  onChange,
  ladder,
  zeroLabel,
  hint,
  disabled = false,
  style,
}: TimeStepperProps) {
  const rungs = resolveLadder(ladder, zeroLabel);
  const lower = adjacentRung(rungs, value, -1);
  const upper = adjacentRung(rungs, value, 1);

  const canDecrease = !disabled && lower !== null;
  const canIncrease = !disabled && upper !== null;

  /**
   * 手输模式：点数值展开"分 / 秒"两个输入框。
   * ± 档位再密也覆盖不了 137 秒这类精确值 —— 梯子管"快"，手输管"准"。
   */
  const [manual, setManual] = useState(false);
  const [minText, setMinText] = useState('');
  const [secText, setSecText] = useState('');

  const maxValue = rungs.length > 0 ? rungs[rungs.length - 1]! : Number.MAX_SAFE_INTEGER;

  const openManual = () => {
    if (disabled) {
      return;
    }
    setMinText(String(Math.floor(value / 60)));
    setSecText(String(value % 60));
    setManual(true);
  };

  const confirmManual = () => {
    const min = Number.parseInt(minText, 10);
    const sec = Number.parseInt(secText, 10);
    const total = (Number.isNaN(min) ? 0 : min) * 60 + (Number.isNaN(sec) ? 0 : sec);
    onChange(Math.max(0, Math.min(total, maxValue)));
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
            onPress={() => {
              if (lower !== null) {
                onChange(lower);
              }
            }}
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
              {value === 0 && zeroLabel !== undefined ? zeroLabel : formatLength(value)}
            </AppText>
          </Pressable>

          <IconButton
            name="add"
            accessibilityLabel={`增加${label}`}
            onPress={() => {
              if (upper !== null) {
                onChange(upper);
              }
            }}
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
            value={minText}
            onChangeText={setMinText}
            keyboardType="number-pad"
            selectTextOnFocus
            autoFocus
            accessibilityLabel={`${label}分钟`}
            style={styles.manualInput}
            maxLength={3}
          />
          <AppText variant="caption" color="textSecondary">
            分
          </AppText>
          <TextInput
            value={secText}
            onChangeText={setSecText}
            keyboardType="number-pad"
            selectTextOnFocus
            accessibilityLabel={`${label}秒`}
            style={styles.manualInput}
            maxLength={3}
          />
          <AppText variant="caption" color="textSecondary">
            秒
          </AppText>
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

      {hint === undefined ? null : (
        <AppText variant="caption" color="textSecondary" style={styles.hint}>
          {hint}
        </AppText>
      )}
    </View>
  );
}

/**
 * 找到 `direction` 方向上的相邻档位。
 * - 完全匹配：直接返回相邻格；
 * - 未匹配：朝该方向吸附到最近一格（向下取最近的小值，向上取最近的大值）。
 */
function adjacentRung(rungs: number[], value: number, direction: 1 | -1): number | null {
  const sorted = rungs;

  if (direction === 1) {
    const next = sorted.find((rung) => rung > value);
    return next ?? null;
  }

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const rung = sorted[index];
    if (rung !== undefined && rung < value) {
      return rung;
    }
  }
  return null;
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  valueBox: {
    minWidth: 76,
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
    width: 64,
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
  hint: {
    marginTop: spacing.xs,
  },
});
