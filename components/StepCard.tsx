/**
 * 编辑器里的单个步骤卡片。
 *
 * ── 为什么它是一个 Design System 组件而不是页面里的 renderItem ─────────
 * 规格明确要求"页面不允许单独写样式"。如果它写在 edit.tsx 里，编辑页就会
 * 立刻出现第二套卡片样式（间距、圆角、阴影各一套），后续想在执行页复用
 * 同样的步骤外观时只能复制粘贴。放在 components/ 下，三处（编辑器、
 * 未来的预览页、步骤详情）共享同一份视觉。
 *
 * ── 折叠的意义 ────────────────────────────────────────────────────
 * 一条任务链可能有十几步，每步都展开"内容输入框 + 两个时长选择器 +
 * 分段控件"会让页面长得离谱、也难以拖拽。所以默认只露出"标题 + 时长"，
 * 描述与提醒音按需展开：常用信息常驻，低频配置收起。
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, dragFeedback, motion, radius, shadow, spacing } from '../theme';
import type { AlertSound, Step } from '../types';
import { AppText } from './AppText';
import { Divider } from './Divider';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { SoundPicker } from './SoundPicker';
import { TextField } from './TextField';
import { TimeStepper } from './TimeStepper';

/**
 * 时长/停歇的离散档位。定义在这里而不是页面里 —— 它属于"选择器的语义"，
 * 页面只负责把用户选中的值存进草稿。
 * 上界分别对应规格的 60 分钟与 30 分钟；0 由 TimeStepper 依据 zeroLabel 自动补上。
 */
export const STEP_DURATION_LADDER: readonly number[] = [
  10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1500, 1800, 2400, 3000, 3600,
];

export const STEP_REST_LADDER: readonly number[] = [
  10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 420, 600, 900, 1200, 1500, 1800,
];

/** 提前取出标量，worklet 里只捕获数字，不捕获整个主题对象。 */
const DRAG_SCALE_DELTA = dragFeedback.scale - 1;

export interface StepCardErrors {
  title?: string;
  durationSec?: string;
}

export interface StepCardProps {
  index: number;
  step: Step;
  /** 最后一步不需要停歇，选择器会被替换成一行说明。 */
  isLast: boolean;
  errors?: StepCardErrors;
  canRemove: boolean;
  /** 正在被拖拽。用于缩放 + 抬起反馈。 */
  isActive: boolean;
  /** 长按手柄时触发，交给 draggable-flatlist 接管。 */
  onDrag: () => void;
  onChange: (patch: Partial<Step>) => void;
  onRemove: () => void;
  onPreviewSound: (sound: AlertSound) => void;
}

export function StepCard({
  index,
  step,
  isLast,
  errors,
  canRemove,
  isActive,
  onDrag,
  onChange,
  onRemove,
  onPreviewSound,
}: StepCardProps) {
  /** 已有描述时默认展开，避免用户看不到自己之前写的内容。 */
  const [expanded, setExpanded] = useState(step.content.length > 0);

  /**
   * 拖拽抬起反馈。用 reanimated 而不是 state + 条件样式，是因为拖拽过程中
   * 每秒会重渲染很多次，动画必须跑在 UI 线程上才不会和手势抢帧。
   */
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withTiming(isActive ? 1 : 0, { duration: motion.fast });
  }, [isActive, lift]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + lift.value * (dragFeedback.scale - 1) }],
  }));

  return (
    <Animated.View
      style={[styles.card, isActive ? shadow.dragging : shadow.card, animatedStyle]}
    >
      <View style={styles.header}>
        <Pressable
          onLongPress={onDrag}
          // 长按 180ms 就接管：默认的 500ms 会让人觉得"拖不动"
          delayLongPress={180}
          accessibilityRole="button"
          accessibilityLabel={`长按拖动第 ${index + 1} 步`}
          hitSlop={spacing.sm}
          style={({ pressed }) => [styles.handle, pressed ? styles.handlePressed : null]}
        >
          <Icon name="reorder-three" size={22} color="textDisabled" />
        </Pressable>

        <AppText variant="overline" color="textSecondary">
          步骤 {index + 1}
        </AppText>

        <View style={styles.headerSpacer} />

        <IconButton
          name="trash-outline"
          accessibilityLabel={`删除第 ${index + 1} 步`}
          onPress={onRemove}
          disabled={!canRemove}
          variant="plain"
          tone="danger"
          size={32}
          iconSize={18}
        />
      </View>

      <TextField
        variant="plain"
        value={step.title}
        onChangeText={(title) => onChange({ title })}
        placeholder="这一步要做什么？"
        error={errors?.title ?? null}
      />

      {expanded ? (
        <TextField
          variant="default"
          value={step.content}
          onChangeText={(content) => onChange({ content })}
          placeholder="补充说明，执行时会显示在标题下方"
          multiline
          minLines={3}
          style={styles.section}
        />
      ) : null}

      <Pressable
        onPress={() => setExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={styles.toggle}
      >
        <Icon name={expanded ? 'chevron-up' : 'add'} size={16} color="primary" />
        <AppText variant="captionStrong" color="primary">
          {expanded ? '收起描述' : '添加描述'}
        </AppText>
      </Pressable>

      <Divider spacingY="md" />

      <View style={styles.section}>
        <TimeStepper
          label="时长"
          value={step.durationSec}
          onChange={(durationSec) => onChange({ durationSec })}
          ladder={STEP_DURATION_LADDER}
          hint={errors?.durationSec ?? '这一步持续多久'}
        />
      </View>

      <View style={styles.section}>
        {isLast ? (
          <View style={styles.lockedRow}>
            <AppText variant="captionStrong" color="textSecondary">
              停歇
            </AppText>
            <AppText variant="caption" color="textDisabled">
              最后一步无需停歇
            </AppText>
          </View>
        ) : (
          <TimeStepper
            label="停歇"
            value={step.restAfterSec}
            onChange={(restAfterSec) => onChange({ restAfterSec })}
            ladder={STEP_REST_LADDER}
            zeroLabel="无停歇"
            hint="这一步结束后，进入下一步之前的间隔"
          />
        )}
      </View>

      <View style={styles.section}>
        <SoundPicker
          value={step.alertSound}
          onChange={(alertSound) => onChange({ alertSound })}
          onPreview={onPreviewSound}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  handle: {
    // 手柄本身比图标大一圈，长按时更容易命中
    width: 32,
    height: 32,
    marginLeft: -spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handlePressed: {
    opacity: 0.5,
  },
  headerSpacer: {
    flex: 1,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
  },
  section: {
    marginTop: spacing.md,
  },
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
