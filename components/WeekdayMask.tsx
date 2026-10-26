/**
 * 每周选择：周一到周日的点选网格
 *
 * ISO 周一=1，周日=7。mask 是逗号分隔的数字字符串，例如 "1,2,3,4,5"。
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { AppText } from './AppText';

interface Props {
  mask: string;
  onChange: (mask: string) => void;
}

const WEEKDAYS = [
  { iso: 1, label: '一' },
  { iso: 2, label: '二' },
  { iso: 3, label: '三' },
  { iso: 4, label: '四' },
  { iso: 5, label: '五' },
  { iso: 6, label: '六' },
  { iso: 7, label: '日' },
];

export function WeekdayMask({ mask, onChange }: Props) {
  const selected = new Set(mask.split(',').map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n)));

  const toggle = (iso: number) => {
    if (selected.has(iso)) {
      selected.delete(iso);
    } else {
      selected.add(iso);
    }
    const next = Array.from(selected).sort((a, b) => a - b).join(',');
    onChange(next);
  };

  return (
    <View style={styles.row}>
      {WEEKDAYS.map(({ iso, label }) => {
        const active = selected.has(iso);
        return (
          <Pressable
            key={iso}
            onPress={() => toggle(iso)}
            style={({ pressed }) => [
              styles.cell,
              active && styles.cellActive,
              pressed && !active && styles.cellPressed,
            ]}
          >
            <AppText variant="caption" color={active ? 'textOnPrimary' : 'text'}>
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  cell: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
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
