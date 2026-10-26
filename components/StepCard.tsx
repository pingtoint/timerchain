/**
 * 编辑器里的单个步骤卡片。
 *
 * ── 折叠交互 ──────────────────────────────────────────────────────
 * 收起态（一行）：手柄 + "步骤 N" + 标题（太长省略号）+ 复制 + 删除 + 展开图标
 * 展开态：标题输入框 + 内容 + 时长 + 停歇 + 提醒音
 * 默认规则：有 content 则展开，否则收起。父组件可通过 props 完全接管。
 *
 * ── 为什么折叠的是全部而非只切内容 ──────────────────────────────────
 * 用户原话"每个步骤都展开拖曳不方便"——高频场景是十几条链、每条时长和
 * 提醒音都已填好，这时拖排序需要卡片尽量矮。如果只切 content，
 * TimeStepper + SoundPicker 还占着 2/3 屏幕，拖起来一样憋屈。
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, dragFeedback, motion, radius, shadow, spacing } from '../theme';
import { STEP_LIMITS, type AlertSound, type Step } from '../types';
import { AppText } from './AppText';
import { Divider } from './Divider';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { NumberStepper } from './NumberStepper';
import { SegmentedControl } from './SegmentedControl';
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
  onDuplicate: () => void;
  onPreviewSound: (sound: AlertSound) => void;
  /** 可选的受控展开态。父组件传了就按这个值渲染，StepCard 内部 toggle 时会调 onToggleExpand；不传则保持内部 state。 */
  expanded?: boolean;
  onToggleExpand?: () => void;
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
  onDuplicate,
  onPreviewSound,
  expanded: expandedProp,
  onToggleExpand,
}: StepCardProps) {
  /** 已有描述时默认展开。受控时使用 props，否则用内部 state。 */
  const [internalExpanded, setInternalExpanded] = useState(step.content.length > 0);
  const expanded = expandedProp ?? internalExpanded;
  const toggleExpand = () => {
    if (onToggleExpand !== undefined) {
      onToggleExpand();
    } else {
      setInternalExpanded((v) => !v);
    }
  };

  /** 补充说明默认收起，需要填写时点开；已有内容的步骤打开时自动展开，避免"内容被藏起来"。 */
  const [contentExpanded, setContentExpanded] = useState(step.content.length > 0);

  /**
   * 拖拽抬起反馈。用 reanimated 而不是 state + 条件样式，是因为拖拽过程中
   * 每秒会重渲染很多次，动画必须跑在 UI 线程上才不会和手势抢帧。
   */
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withTiming(isActive ? 1 : 0, { duration: motion.fast });
  }, [isActive, lift]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + lift.value * DRAG_SCALE_DELTA }],
  }));

  const stepLabel = `步骤 ${index + 1}`;

  return (
    <Animated.View
      style={[styles.card, isActive ? shadow.dragging : shadow.card, animatedStyle]}
    >
      {/* ── 头部：拖拽手柄 + 编号 + 标题（收起时显示 + 省略号）+ 复制 + 删除 + 展开图标 ── */}
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

        <AppText variant="overline" color="textSecondary" style={styles.headerLabel}>
          {stepLabel}
        </AppText>

        {/* 收起态显示标题预览（单行省略号）；展开态标题在 TextField 里单独显示 */}
        {!expanded ? (
          <AppText variant="body" color="text" style={styles.titlePreview} numberOfLines={1}>
            {step.title.trim().length > 0 ? step.title : '（未命名步骤）'}
          </AppText>
        ) : (
          <View style={styles.headerSpacer} />
        )}

        <IconButton
          name="copy-outline"
          accessibilityLabel={`复制第 ${index + 1} 步`}
          onPress={onDuplicate}
          variant="plain"
          size={32}
          iconSize={18}
        />
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

        <Pressable
          onPress={toggleExpand}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? '收起此步骤' : '展开此步骤'}
          hitSlop={spacing.sm}
          style={styles.expandToggle}
        >
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color="textSecondary" />
        </Pressable>
      </View>

      {/* ── 展开态：全部编辑区 ──────────────────────────────────────── */}
      {expanded ? (
        <>
          <TextField
            variant="plain"
            value={step.title}
            onChangeText={(title) => onChange({ title })}
            placeholder="这一步要做什么？"
            error={errors?.title ?? null}
          />

          {/* 补充说明：默认收起为一行开关，需要填写时点开 */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: contentExpanded }}
            accessibilityLabel={contentExpanded ? '收起补充说明' : '填写补充说明'}
            onPress={() => setContentExpanded((v) => !v)}
            style={[styles.contentToggle, styles.section]}
          >
            <Icon name="document-text-outline" size={18} color="textSecondary" />
            <AppText variant="captionStrong" color="textSecondary" style={{ flex: 1 }}>
              补充说明
            </AppText>
            {!contentExpanded && step.content.trim().length > 0 ? (
              <AppText variant="caption" color="textDisabled" numberOfLines={1} style={styles.contentPreview}>
                {step.content}
              </AppText>
            ) : null}
            <Icon name={contentExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="textSecondary" />
          </Pressable>
          {contentExpanded ? (
            <TextField
              variant="default"
              value={step.content}
              onChangeText={(content) => onChange({ content })}
              placeholder="执行时会显示在标题下方"
              multiline
              minLines={3}
              style={styles.contentField}
            />
          ) : null}

          <Divider spacingY="md" />

          {/* 计量方式二选一：时长（倒计时）| 次数（手动完成）。选中项的设置内容紧跟下方 */}
          <View style={styles.section}>
            <SegmentedControl
              options={[
                { value: 'timed', label: '时长', icon: 'time-outline' },
                { value: 'count', label: '次数', icon: 'repeat-outline' },
              ]}
              value={step.kind}
              onChange={(kind) =>
                onChange(
                  kind === 'count'
                    ? // 切到计次：时长归零由归一化兜底，这里先把界面口径切过去
                      { kind, durationSec: 0 }
                    : // 切回计时：恢复一个合理默认时长，次数/间隙由归一化强制 1/0
                      { kind, durationSec: 5 * 60, repeatCount: 1, repeatRestSec: 0 },
                )
              }
            />
          </View>

          {step.kind === 'count' ? (
            <View style={styles.section}>
              <NumberStepper
                label="次数"
                value={step.repeatCount}
                min={1}
                max={STEP_LIMITS.repeatMaxCount}
                onChange={(repeatCount) =>
                  onChange(
                    repeatCount === 1
                      ? { repeatCount, repeatRestSec: 0 }
                      : { repeatCount },
                  )
                }
                unit="次"
              />
              {step.repeatCount > 1 ? (
                <View style={styles.gapRow}>
                  <NumberStepper
                    label="间隙"
                    value={step.repeatRestSec}
                    min={0}
                    max={STEP_LIMITS.repeatRestMaxSec}
                    onChange={(repeatRestSec) => onChange({ repeatRestSec })}
                    unit="秒"
                  />
                </View>
              ) : null}
              <AppText variant="caption" color="textDisabled" style={styles.kindHint}>
                执行时不倒计时，做完一遍点「完成本遍」
              </AppText>
            </View>
          ) : (
            <View style={styles.section}>
              <TimeStepper
                label="时长"
                value={step.durationSec}
                onChange={(durationSec) => onChange({ durationSec })}
                ladder={STEP_DURATION_LADDER}
                hint={errors?.durationSec ?? '这一步持续多久'}
              />
            </View>
          )}

          {/* ── 公共部分：两种计量方式共用 ── */}
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
        </>
      ) : null}
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
    gap: spacing.xs,
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
  headerLabel: {
    // 固定宽度避免标题过长时把编号挤没
    minWidth: 52,
  },
  titlePreview: {
    flex: 1,
  },
  headerSpacer: {
    flex: 1,
  },
  expandToggle: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginTop: spacing.md,
  },
  contentToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  contentPreview: {
    flex: 2,
    textAlign: 'right',
  },
  contentField: {
    marginTop: spacing.sm,
  },
  gapRow: {
    marginTop: spacing.md,
  },
  kindHint: {
    marginTop: spacing.sm,
  },
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
