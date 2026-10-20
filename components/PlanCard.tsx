/**
 * 任务链卡片。
 *
 * 信息层级只有两层：标题（主）+ 元信息（次）。刻意不显示创建时间、
 * 不显示缩略图 —— 列表页要回答的唯一问题是"我要跑哪一条"，
 * 任何与这个决策无关的信息都是在稀释它。
 */

import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow, spacing } from '../theme';
import type { PlanSummary } from '../types';
import { formatPlanMeta } from '../utils/format';
import { AppText } from './AppText';
import { Icon } from './Icon';

export interface PlanCardProps {
  summary: PlanSummary;
  onPress: () => void;
  /** 该任务链正在执行时给出标记，避免用户重复进入同一个任务。 */
  running?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PlanCard({ summary, onPress, running = false, style }: PlanCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${summary.title}，${formatPlanMeta(summary.stepCount, summary.totalDurationSec)}`}
      style={({ pressed }) => [
        styles.card,
        shadow.card,
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      <View style={[styles.badge, running ? styles.badgeRunning : null]}>
        <Icon
          name={running ? 'timer-outline' : 'play'}
          size={18}
          color={running ? 'warning' : 'primary'}
        />
      </View>

      <View style={styles.body}>
        <AppText variant="title" numberOfLines={1}>
          {summary.title}
        </AppText>
        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
          {formatPlanMeta(summary.stepCount, summary.totalDurationSec)}
        </AppText>
      </View>

      {running ? (
        <View style={styles.runningTag}>
          <AppText variant="overline" color="warning">
            执行中
          </AppText>
        </View>
      ) : null}

      <Icon name="chevron-forward" size={18} color="textDisabled" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.bg,
  },
  pressed: {
    backgroundColor: colors.bgSecondary,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  badgeRunning: {
    backgroundColor: colors.bgSecondary,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  runningTag: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSecondary,
  },
});
