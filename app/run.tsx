/**
 * 执行页。
 *
 * ── 页面只做三件事 ─────────────────────────────────────────────────
 * 1. 把 store 里的 `run` 渲染出来（倒计时、当前步骤、进度）；
 * 2. 提供 暂停/继续、终止 两个动作；
 * 3. 在执行被中断时**先征求确认**（规格 E）。
 *
 * 它自己**不含任何计时逻辑**：心跳由 `useTimer()` 挂载，剩余时间由 store 基于
 * 结束时间戳现算。这样即使这个页面被重渲染、甚至被卸载再挂载，倒计时也不会
 * 因此变慢或跳变 —— 时间只有一个权威来源。
 *
 * ── 中断确认为什么用 usePreventRemove ────────────────────────────
 * 离开执行页有四条路径：头部返回按钮、Android 物理返回键、iOS 侧滑手势、
 * 以及程序化跳转。前两条可以自己拦截，侧滑手势却不行 —— 而"只是想在页面上
 * 横向划一下，结果把正在跑的任务划掉了"是最让人火大的一种体验。
 * `usePreventRemove` 统一拦住这四条，确认后再放行，行为完全一致。
 */

import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePreventRemove, useRouter } from 'expo-router';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import {
  AppText,
  Button,
  Dialog,
  EmptyState,
  Header,
  Screen,
  StepIndicator,
} from '../components';
import { useTimer } from '../hooks/useTimer';
import { usePlanStore } from '../store/planStore';
import { motion, spacing } from '../theme';
import { formatClock, formatStepCounter } from '../utils/format';

export default function RunScreen() {
  // 心跳 + 前后台对账。计时精度由它保证，页面本身不碰定时器。
  useTimer();

  const router = useRouter();
  const plan = usePlanStore((state) => state.activePlan);
  const run = usePlanStore((state) => state.run);
  const pauseRun = usePlanStore((state) => state.pauseRun);
  const resumeRun = usePlanStore((state) => state.resumeRun);
  const stopRun = usePlanStore((state) => state.stopRun);

  const [confirmVisible, setConfirmVisible] = useState(false);
  /** 被拦截的导航动作的"重放"函数（由 usePreventRemove 提供）。 */
  const repeatRef = useRef<(() => void) | null>(null);

  const isRunning = run.status === 'running';
  const isPaused = run.status === 'paused';
  const isFinished = run.status === 'finished';
  const isActive = isRunning || isPaused;

  const disablePrevention = usePreventRemove(isActive, ({ repeat }) => {
    // 括号里不直接弹窗：这里拿到的 repeat 需要等用户在弹窗里点了"终止"才用，
    // 所以先存下来，由 confirmLeave 决定重放还是干脆自己导航。
    repeatRef.current = repeat;
    setConfirmVisible(true);
  });

  /** 真正离开页面。先停表，再放行导航。 */
  const exitNow = useCallback(() => {
    stopRun();

    const repeat = repeatRef.current;
    repeatRef.current = null;
    if (repeat !== null) {
      // 来自侧滑/物理返回键：重放原动作，去哪个页面由原动作决定
      repeat();
      return;
    }

    // 来自头部按钮或"终止"按钮：自己导航。
    // 必须先 disablePrevention()，否则这次 back() 会被自己的拦截规则挡回去。
    disablePrevention();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [disablePrevention, router, stopRun]);

  const requestLeave = useCallback(() => {
    // 只有"还在跑"的时候才需要确认；已完成或未开始，直接走。
    if (isActive) {
      setConfirmVisible(true);
      return;
    }
    exitNow();
  }, [exitNow, isActive]);

  if (plan === null) {
    return (
      <Screen variant="plain">
        <Header title="执行" onBack={exitNow} />
        <EmptyState
          icon="timer-outline"
          title="没有正在执行的任务"
          description="回到列表，选择一条任务链开始专注"
          action={<Button label="返回列表" fullWidth onPress={exitNow} />}
        />
      </Screen>
    );
  }

  const total = plan.steps.length;
  const currentStep = plan.steps[run.currentIndex];
  const nextStep = plan.steps[run.currentIndex + 1];
  const isRest = run.phase === 'rest' && !isFinished;

  const headerTitle = isFinished
    ? '全部完成'
    : isRest
      ? '休息中'
      : formatStepCounter(run.currentIndex + 1, total);

  const bodyText = resolveBodyText(isFinished, isRest, currentStep?.content, nextStep?.title);

  return (
    <Screen variant="plain">
      <Header title={headerTitle} subtitle={plan.title} onBack={requestLeave} />

      <StepIndicator
        total={total}
        currentIndex={run.currentIndex}
        phase={run.phase}
        allDone={isFinished}
        style={styles.indicator}
      />

      <View style={styles.center}>
        {/*
          步骤切换的淡入淡出（规格：200ms）。用 `key` 强制重挂载来触发进出场动画，
          这样"上一步淡出、下一步淡入"是同时发生的交叉过渡，而不是先消失再出现。
        */}
        <Animated.View
          key={`${run.currentIndex}-${run.phase}-${isFinished ? 'done' : 'live'}`}
          entering={FadeIn.duration(motion.base)}
          exiting={FadeOut.duration(motion.base)}
          style={styles.stepBlock}
        >
          <AppText
            variant="overline"
            color={isFinished ? 'success' : isRest ? 'warning' : 'primary'}
            align="center"
          >
            {isFinished ? '已完成' : isRest ? '休息中' : '当前步骤'}
          </AppText>

          <AppText variant="h1" align="center" style={styles.title}>
            {isFinished ? '全部完成 🎉' : isRest ? '休息一下' : currentStep?.title ?? ''}
          </AppText>

          {bodyText === null ? null : (
            <AppText variant="body" color="textSecondary" align="center" style={styles.body}>
              {bodyText}
            </AppText>
          )}
        </Animated.View>

        {isFinished ? null : (
          <>
            <AppText
              variant="display"
              color={isPaused ? 'textSecondary' : 'primary'}
              tabular
              align="center"
              style={styles.clock}
            >
              {formatClock(run.remainingSec)}
            </AppText>

            <AppText variant="caption" color="textSecondary" align="center">
              {isPaused ? '已暂停' : isRest ? '休息倒计时' : '本步剩余时间'}
            </AppText>
          </>
        )}
      </View>

      <View style={styles.footer}>
        {isFinished ? (
          <Button label="返回列表" size="lg" fullWidth onPress={exitNow} />
        ) : (
          <View style={styles.actions}>
            <Button
              label={isRunning ? '暂停' : '继续'}
              icon={isRunning ? 'pause' : 'play'}
              variant="secondary"
              size="lg"
              style={styles.actionButton}
              onPress={isRunning ? pauseRun : resumeRun}
            />
            <Button
              label="终止"
              icon="stop"
              variant="danger"
              size="lg"
              style={styles.actionButton}
              onPress={requestLeave}
            />
          </View>
        )}
      </View>

      <Dialog
        visible={confirmVisible}
        title="终止当前任务？"
        message="已经完成的进度不会保留，再次开始会从第一步重新计时。"
        confirmLabel="终止"
        cancelLabel="继续执行"
        tone="danger"
        onCancel={() => {
          repeatRef.current = null;
          setConfirmVisible(false);
        }}
        onConfirm={exitNow}
      />
    </Screen>
  );
}

/**
 * 中间区域的一句说明。
 *
 * 三种阶段的语义完全不同，所以文案必须分开：
 * - 步骤中：显示这一步的补充说明；
 * - 休息中：显示"接下来是哪一步"，因为休息的全部意义就是为下一步做准备；
 * - 已完成：给一句收尾，而不是留一片空白。
 */
function resolveBodyText(
  isFinished: boolean,
  isRest: boolean,
  stepContent: string | undefined,
  nextTitle: string | undefined,
): string | null {
  if (isFinished) {
    return '这条任务链已经跑完，可以休息了';
  }
  if (isRest) {
    return nextTitle === undefined ? '稍作调整，准备收尾' : `接下来：${nextTitle}`;
  }
  if (stepContent !== undefined && stepContent.length > 0) {
    return stepContent;
  }
  return null;
}

const styles = StyleSheet.create({
  indicator: {
    marginTop: spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBlock: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    marginTop: spacing.xs,
  },
  body: {
    marginTop: spacing.xs,
    maxWidth: 320,
  },
  clock: {
    marginTop: spacing.xl,
  },
  footer: {
    paddingTop: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
});
