/**
 * 任务链卡片。
 *
 * 视觉层次：
 *   ┌─┐ ┌──────────────────────────────────────────┐ ┌───┐ ┌──┐
 *   │ │ │  标题                               ⏰ ... │ 执 │ │› │
 *   │ │ │  X 步 · X 分 X 秒          (可选提醒)   │ 行 │ │  │
 *   └─┘ └──────────────────────────────────────────┘ └───┘ └──┘
 *    ↑                                              ↑
 * 左侧 accent bar                              运行状态胶囊
 * （有提醒=primary，执行中=warning，无=透明）
 *
 * 点击 / 长按 / 执行中标记都保持清晰的交互语义。
 */

import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useEffect, useRef } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius, shadow, spacing } from '../theme';
import type { PlanSummary } from '../types';
import { formatPlanMeta } from '../utils/format';
import { formatFireDate, formatRepeatDescription } from '../notifications/notificationService';
import { AppText } from './AppText';
import { Icon } from './Icon';

export interface PlanCardProps {
  summary: PlanSummary;
  onPress: () => void;
  /** 长按进入编辑器或触发拖拽。可选，未提供时长按不触发任何动作。 */
  onLongPress?: () => void;
  /** 长按触发的毫秒数。默认 500。拖拽场景传 180 可快速接管手势。 */
  delayLongPress?: number;
  /** 该任务链正在执行时给出标记，避免用户重复进入同一个任务。 */
  running?: boolean;
  /** "过期"判断的时间基准（epoch ms）。由父级在 effect 里取好传入，
   *  渲染期调 Date.now 违反 react-hooks/purity。缺省按不过期处理。 */
  nowMs?: number;
  style?: StyleProp<ViewStyle>;
}

export function PlanCard({ summary, onPress, onLongPress, delayLongPress, running = false, nowMs, style }: PlanCardProps) {
  const reminder = summary.reminder;
  const hasReminder = reminder !== null && reminder !== undefined && reminder.enabled;
  const isExpired =
    hasReminder &&
    reminder!.repeatMode === 'once' &&
    reminder!.scheduledFor !== null &&
    reminder!.scheduledFor !== undefined &&
    nowMs !== undefined &&
    reminder!.scheduledFor < nowMs;

  // 左侧 accent bar 颜色
  const accentColor = running
    ? colors.warning
    : hasReminder
      ? colors.primary
      : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${summary.title}，${formatPlanMeta(summary.stepCount, summary.totalDurationSec)}${hasReminder ? `，${formatRepeatDescription(reminder!)}` : ''}`}
      style={({ pressed }) => [
        styles.card,
        shadow.card,
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      {/* 左侧 4px 彩色 accent bar —— 一眼区分提醒/执行中/普通 */}
      <View style={[styles.accentBar, { backgroundColor: accentColor }]} />

      <View style={styles.mainRow}>
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
          {hasReminder ? (
            <AppText
              variant="caption"
              color={isExpired ? 'textSecondary' : 'primary'}
              style={isExpired ? styles.expired : undefined}
              numberOfLines={1}
            >
              ⏰ {reminder!.repeatMode === 'once'
                ? formatFireDate(reminder!.scheduledFor!)
                : formatRepeatDescription(reminder!)}
            </AppText>
          ) : null}
        </View>

        {running ? (
          <RunningPill />
        ) : null}

        <Icon name="chevron-forward" size={18} color="textDisabled" />
      </View>
    </Pressable>
  );
}

/** "执行中"胶囊 —— 脉冲透明度让用户一眼看到它正在跑。 */
function RunningPill() {
  const pulse = useSharedValue(1);
  const stopped = useRef(false);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.4, { duration: 1200, easing: Easing.out(Easing.ease) }),
      -1,
      true,
    );
    return () => {
      stopped.current = true;
    };
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={[styles.runningTag, style]}>
      <AppText variant="overline" color="warning">
        执行中
      </AppText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.bg,
    overflow: 'hidden', // accent bar 圆角跟着卡片
  },
  pressed: {
    backgroundColor: colors.bgSecondary,
  },
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    // 主色 12% 透明度渐变 —— 比纯色 primarySoft 更有层次
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
  expired: {
    fontStyle: 'italic',
  },
});
