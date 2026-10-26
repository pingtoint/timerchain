/**
 * 每月选择：1~31 号的网格（简化版 —— 31 个按钮一行放不下，用 3x11 网格）
 *
 * mask 是逗号分隔的数字字符串，例如 "1,15,30"。
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { AppText } from './AppText';

interface Props {
  mask: string;
  onChange: (mask: string) => void;
}

export function MonthDayMask({ mask, onChange }: Props) {
  const selected = new Set(mask.split(',').map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n)));

  const toggle = (day: number) => {
    if (selected.has(day)) {
      selected.delete(day);
    } else {
      selected.add(day);
    }
    const next = Array.from(selected).sort((a, b) => a - b).join(',');
    onChange(next);
  };

  const days: number[] = [];
  for (let i = 1; i <= 31; i += 1) days.push(i);

  return (
    <View style={styles.grid}>
      {days.map((day) => {
        const active = selected.has(day);
        return (
          <Pressable
            key={day}
            onPress={() => toggle(day)}
            style={({ pressed }) => [
              styles.cell,
              active && styles.cellActive,
              pressed && !active && styles.cellPressed,
            ]}
          >
            <AppText variant="caption" color={active ? 'textOnPrimary' : 'text'}>
              {day}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: spacing.xs,
  },
  cell: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSecondary,
  },
  cellActive: {
    backgroundColor: colors.primary,
  },
  cellPressed: {
    backgroundColor: colors.bgSecondaryPressed,
  },
});
