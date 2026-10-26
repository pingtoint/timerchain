/**
 * 执行页。
 *
 * ── 页面只做三件事 ─────────────────────────────────────────────────
 * 1. 把 store 里的 `run` 渲染出来（倒计时、当前步骤、进度）；
 * 2. 提供 暂停/继续、终止 两个动作；
 * 3. 运行时离开页面**不终止任务** —— FGS 前台服务通知接管控制，
 *    用户可以在通知栏点暂停/终止，或回到 App 继续看。
 *
 * ── 为什么不拦截返回 ──────────────────────────────────────────────
 * 之前用 usePreventRemove 拦住所有离开路径（返回键、侧滑、头部按钮），
 * 导致用户跑着任务时根本走不出执行页 —— 这完全违背了 FGS 的设计初衷。
 * 美团外卖、Keep 的做法：执行/配送中，用户可以自由切出 App，
 * 通知栏的常驻卡片继续显示进度并提供控制入口。
 *
 * 终止任务的唯一入口：执行页的"终止"按钮 + 通知栏的"终止"按钮。
 * 这两个入口才需要二次确认（规格 E），导航离开不需要。
 */

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
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
  const completeRep = usePlanStore((state) => state.completeRep);

  const [confirmVisible, setConfirmVisible] = useState(false);

  const isRunning = run.status === 'running';
  const isPaused = run.status === 'paused';
  const isFinished = run.status === 'finished';

  /** 头部返回 / Android 返回键 / iOS 侧滑 —— 不终止任务，FGS 接管。 */
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [router]);

  /** 显式终止任务（执行页"终止"按钮）—— 需要二次确认。 */
  const requestStop = useCallback(() => {
    if (isFinished) {
      stopRun();
      handleBack();
      return;
    }
    setConfirmVisible(true);
  }, [isFinished, stopRun, handleBack]);

  const confirmStop = useCallback(() => {
    setConfirmVisible(false);
    stopRun();
    handleBack();
  }, [stopRun, handleBack]);

  if (plan === null) {
    return (
      <Screen variant="plain">
        <Header title="执行" onBack={handleBack} />
        <EmptyState
          icon="timer-outline"
          title="没有正在执行的任务"
          description="回到列表，选择一条任务链开始专注"
          action={<Button label="返回列表" fullWidth onPress={handleBack} />}
        />
      </Screen>
    );
  }

  const total = plan.steps.length;
  const currentStep = plan.steps[run.currentIndex];
  const nextStep = plan.steps[run.currentIndex + 1];
  const isGap = run.phase === 'repeatRest' && !isFinished;
  const isRest = (run.phase === 'rest' || run.phase === 'repeatRest') && !isFinished;
  const repeatTotal = currentStep?.repeatCount ?? 1;
  /** 计次步骤的计次阶段：表在正数走，推进靠"完成本遍"。 */
  const isCountRep = !isFinished && !isRest && currentStep?.kind === 'count';

  const headerTitle = isFinished
    ? '全部完成'
    : isGap
      ? '间隙中'
      : isRest
        ? '休息中'
        : formatStepCounter(run.currentIndex + 1, total);

  const bodyText = isGap
    ? `即将开始第 ${Math.min(run.repeatIndex + 2, repeatTotal)}/${repeatTotal} 遍`
    : resolveBodyText(isFinished, isRest, currentStep?.content, nextStep?.title);

  return (
    <Screen variant="plain">
      <Header title={headerTitle} subtitle={plan.title} onBack={handleBack} />

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
            {isFinished ? '已完成' : isGap ? '间隙中' : isRest ? '休息中' : '当前步骤'}
          </AppText>

          <AppText variant="h1" align="center" style={styles.title}>
            {isFinished ? '全部完成 🎉' : isRest ? '休息一下' : currentStep?.title ?? ''}
          </AppText>

          {/* 多遍步骤：计时阶段显示"第 X/N 遍"，Tabata 场景的位置感全靠它 */}
          {!isFinished && !isRest && repeatTotal > 1 ? (
            <AppText variant="bodyStrong" color="primary" align="center">
              第 {Math.min(run.repeatIndex + 1, repeatTotal)}/{repeatTotal} 遍
            </AppText>
          ) : null}

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
              {isPaused
                ? '已暂停'
                : isRest
                  ? '休息倒计时'
                  : isCountRep
                    ? '已进行'
                    : '本步剩余时间'}
            </AppText>
          </>
        )}
      </View>

      <View style={styles.footer}>
        {isFinished ? (
          <Button label="返回列表" size="lg" fullWidth onPress={handleBack} />
        ) : (
          <>
            {/* 计次阶段的主按钮：做完一遍手动推进。暂停时必须先继续，避免"暂停中完成"的歧义状态 */}
            {isCountRep && isRunning ? (
              <Button
                label={
                  run.repeatIndex < repeatTotal - 1
                    ? `完成第 ${run.repeatIndex + 1} 遍`
                    : '完成本步'
                }
                icon="checkmark"
                size="lg"
                fullWidth
                onPress={completeRep}
                style={styles.completeButton}
              />
            ) : null}
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
                onPress={requestStop}
              />
            </View>
          </>
        )}
      </View>

      <Dialog
        visible={confirmVisible}
        title="终止当前任务？"
        message="已经完成的进度不会保留，再次开始会从第一步重新计时。"
        confirmLabel="终止"
        cancelLabel="继续执行"
        tone="danger"
        onCancel={() => setConfirmVisible(false)}
        onConfirm={confirmStop}
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
  completeButton: {
    marginBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
});
