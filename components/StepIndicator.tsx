/**
 * 任务链进度指示器：一排小段，已完成的填实、当前的高亮、未开始的留灰。
 *
 * 为什么不只显示"步骤 2/5"文字：数字回答不了"还有多少"这个问题 ——
 * 人脑对长度的感知远快于对数字的解析。两者一起用，看一眼就知道进度。
 * 步骤数超过 `maxSegments` 时退化成纯文字，避免小段细到看不见。
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../theme';
import type { RunPhase } from '../types';

export interface StepIndicatorProps {
  total: number;
  currentIndex: number;
  phase: RunPhase;
  /** 全部完成时所有小段都填实，作为"跑完整条链"的收尾视觉。 */
  allDone?: boolean;
  maxSegments?: number;
  style?: StyleProp<ViewStyle>;
}

const MAX_SEGMENTS = 12;

export function StepIndicator({
  total,
  currentIndex,
  phase,
  allDone = false,
  maxSegments = MAX_SEGMENTS,
  style,
}: StepIndicatorProps) {
  if (total <= 0 || total > maxSegments) {
    return null;
  }

  return (
    <View style={[styles.row, style]} accessibilityRole="progressbar">
      {Array.from({ length: total }, (_, index) => {
        const done = allDone || index < currentIndex;
        const current = !allDone && index === currentIndex;
        return (
          <View
            key={index}
            style={[
              styles.segment,
              done ? styles.done : null,
              allDone ? styles.current : null,
              current ? (phase === 'rest' ? styles.currentRest : styles.current) : null,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignSelf: 'stretch',
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  done: {
    backgroundColor: colors.primaryDisabled,
  },
  current: {
    backgroundColor: colors.primary,
  },
  /** 休息阶段用 warning 色，让"正在休息"在余光里也能分辨。 */
  currentRest: {
    backgroundColor: colors.warning,
  },
});
