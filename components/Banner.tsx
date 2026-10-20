/**
 * 阶段切换横幅（规格 B）。
 *
 * 行为刻意收敛为"出现 3 秒后自己淡出"，而不是常驻或需要手动关掉：
 * 每步开始时用户需要知道"现在做什么"，但 3 秒之后这条信息就不再有用，
 * 继续占着屏幕顶部反而挡住了内容。
 *
 * 组件自己管理可见性（而不是由页面传 visible），因为它唯一的数据源就是
 * store 里的 alert。挂在根布局，所以无论用户当前在哪个页面都能看到。
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { colors, motion, radius, shadow, spacing } from '../theme';
import type { RunAlert, RunAlertKind } from '../types';
import { AppText } from './AppText';
import { Icon, type IconColor, type IconName } from './Icon';

export interface BannerProps {
  alert: RunAlert | null;
  /** 停留时长，默认取主题的 3000ms。 */
  durationMs?: number;
}

interface KindMeta {
  icon: IconName;
  tone: IconColor;
  kicker: string;
}

const KIND_META: Record<RunAlertKind, KindMeta> = {
  step: { icon: 'play', tone: 'primary', kicker: '当前步骤' },
  rest: { icon: 'cafe-outline', tone: 'warning', kicker: '休息中' },
  finished: { icon: 'checkmark', tone: 'success', kicker: '全部完成' },
};

export function Banner({ alert, durationMs = motion.bannerVisibleMs }: BannerProps) {
  /** 记住正在展示的提醒序号；null = 不展示。 */
  const [shownSeq, setShownSeq] = useState<number | null>(null);

  useEffect(() => {
    if (alert === null) {
      setShownSeq(null);
      return;
    }
    setShownSeq(alert.seq);
    const timer = setTimeout(() => {
      // 只在"还是这条提醒"时收起：期间来了新提醒的话，那条提醒的 effect
      // 已经重设过 shownSeq，这里的回调必须让位，否则会把新横幅一起关掉。
      setShownSeq((current) => (current === alert.seq ? null : current));
    }, durationMs);

    return () => {
      clearTimeout(timer);
    };
  }, [alert, durationMs]);

  if (alert === null || shownSeq === null) {
    return null;
  }

  const meta = KIND_META[alert.kind];
  const title = bannerTitle(alert);

  return (
    <Animated.View
      pointerEvents="none"
      entering={FadeInDown.duration(motion.base)}
      exiting={FadeOutUp.duration(motion.base)}
      style={styles.wrapper}
    >
      <View style={[styles.card, shadow.raised]}>
        <View style={styles.iconBubble}>
          <Icon name={meta.icon} size={18} color={meta.tone} />
        </View>

        <View style={styles.body}>
          <AppText variant="overline" color={meta.tone}>
            {meta.kicker}
          </AppText>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {title}
          </AppText>
          {alert.skippedPhases > 0 ? (
            <AppText variant="caption" color="textSecondary">
              后台期间已跳过 {alert.skippedPhases} 个阶段
            </AppText>
          ) : alert.stepContent !== null && alert.stepContent.length > 0 ? (
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              {alert.stepContent}
            </AppText>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

/** 休息阶段拿到的是"即将开始的下一步"标题，因此文案要说"接下来"。 */
function bannerTitle(alert: RunAlert): string {
  if (alert.kind === 'finished') {
    return '全部完成 🎉';
  }
  const name = alert.stepTitle ?? '下一步';
  return alert.kind === 'rest' ? `接下来：${name}` : name;
}

const styles = StyleSheet.create({
  wrapper: {
    // 绝对定位由根布局承载，这里只负责卡片自身的排布
    alignSelf: 'stretch',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSecondary,
  },
  body: {
    flex: 1,
    gap: 2,
  },
});
