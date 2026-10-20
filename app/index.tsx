/**
 * 任务列表页。
 *
 * ── 交互决策 ──────────────────────────────────────────────────────
 * 1. 只保留底部一个主按钮（规格建议）：顶部再加一个 "+" 会让"新建"
 *    这个动作有两个入口，用户每次都要重新决定点哪个。
 * 2. 点击卡片 = 进入执行页并**自动开始**。理由：这个 App 里用户点开一条
 *    任务链的唯一动机就是"现在跑它"，让用户进去再点一次开始是多此一举。
 * 3. 删除走自定义左滑（SwipeRow）；只有删除"正在执行的那条"才额外弹确认 ——
 *    其它情况左滑本身就是一次足够明确的意图表达。
 */

import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Button,
  Dialog,
  EmptyState,
  Header,
  IconButton,
  PlanCard,
  Screen,
  StateView,
  SwipeRow,
} from '../components';
import { usePlanStore } from '../store/planStore';
import { spacing } from '../theme';
import type { PlanSummary } from '../types';

export default function PlanListScreen() {
  const router = useRouter();

  // 精确订阅：`run` 对象每秒都在变，整体订阅会让列表页跟着每一次心跳重渲染。
  // 这里只取"是否有正在执行的任务链 id"这一个字符串。
  const runningPlanId = usePlanStore((state) =>
    state.run.status === 'running' || state.run.status === 'paused' ? state.run.planId : null,
  );
  const plans = usePlanStore((state) => state.plans);
  const listStatus = usePlanStore((state) => state.listStatus);
  const listError = usePlanStore((state) => state.listError);
  const loadPlans = usePlanStore((state) => state.loadPlans);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);
  const startRun = usePlanStore((state) => state.startRun);
  const deletePlan = usePlanStore((state) => state.deletePlan);

  /** 正在读取的卡片 id，用于避免连点打开两条任务链。 */
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PlanSummary | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);

  // 每次回到本页都重新读一次：编辑页保存后返回，列表必须立刻反映最新数据。
  useFocusEffect(
    useCallback(() => {
      void loadPlans();
    }, [loadPlans]),
  );

  const openPlan = useCallback(
    (id: string) => {
      if (openingId !== null) {
        return;
      }
      setOpeningId(id);

      void (async () => {
        try {
          const plan = await loadPlanById(id);
          if (plan === null) {
            setNotice({ title: '任务不存在', message: '这条任务链可能已经被删除了。' });
            await loadPlans();
            return;
          }
          if (plan.steps.length === 0) {
            setNotice({ title: '无法执行', message: '这条任务链还没有任何步骤。' });
            return;
          }
          startRun(plan);
          router.push('/run');
        } finally {
          setOpeningId(null);
        }
      })();
    },
    [loadPlanById, loadPlans, openingId, router, startRun],
  );

  const requestDelete = useCallback(
    (item: PlanSummary) => {
      // 规格 E：删除正在执行的任务前必须先终止。终止是不可逆的，
      // 所以这一步必须让用户明确确认，而不是左滑就直接生效。
      if (item.id === runningPlanId) {
        setPendingDelete(item);
        return;
      }
      void deletePlan(item.id);
    },
    [deletePlan, runningPlanId],
  );

  const renderItem = useCallback(
    ({ item }: { item: PlanSummary }) => (
      <View style={styles.cardWrap}>
        <SwipeRow onDelete={() => requestDelete(item)}>
          <PlanCard
            summary={item}
            running={item.id === runningPlanId}
            onPress={() => openPlan(item.id)}
          />
        </SwipeRow>
      </View>
    ),
    [openPlan, requestDelete, runningPlanId],
  );

  const emptyComponent =
    plans.length > 0 ? undefined : renderEmptyState(listStatus, listError, loadPlans);

  return (
    <Screen variant="grouped">
      <Header
        title="TimerChain"
        subtitle="把一段专注拆成一条链"
        right={
          <IconButton
            name="settings-outline"
            accessibilityLabel="设置"
            onPress={() => router.push('/settings')}
          />
        }
      />

      <FlatList
        data={plans}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={emptyComponent}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.footer}>
        <Button
          label="新建任务"
          icon="add"
          size="lg"
          fullWidth
          onPress={() => router.push('/edit')}
        />
      </View>

      <Dialog
        visible={pendingDelete !== null}
        title="终止并删除？"
        message={
          pendingDelete === null
            ? undefined
            : `「${pendingDelete.title}」正在执行，删除会立即终止它。`
        }
        confirmLabel="终止并删除"
        tone="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target !== null) {
            void deletePlan(target.id);
          }
        }}
      />

      <Dialog
        visible={notice !== null}
        title={notice?.title ?? ''}
        message={notice?.message}
        confirmLabel="知道了"
        cancelLabel="返回"
        onCancel={() => setNotice(null)}
        onConfirm={() => setNotice(null)}
      />
    </Screen>
  );
}

/** 空/加载/错误三态在这里分流，保证"没有任何数据"时不会闪出一片白。 */
function renderEmptyState(
  listStatus: ReturnType<typeof usePlanStore.getState>['listStatus'],
  listError: string | null,
  retry: () => Promise<void>,
): React.ReactElement {
  if (listStatus === 'loading' || listStatus === 'idle') {
    return <StateView variant="loading" description="正在从本地数据库读取任务链" />;
  }

  if (listStatus === 'error') {
    return (
      <StateView
        variant="error"
        description={listError ?? undefined}
        onRetry={() => {
          void retry();
        }}
      />
    );
  }

  return (
    <EmptyState
      icon="list-outline"
      title="还没有任务"
      description="创建你的第一条任务链，开始专注"
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    // flexGrow 让 ListEmptyComponent 能撑满剩余高度，空状态才能真正"居中"
    flexGrow: 1,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  cardWrap: {
    marginBottom: spacing.md,
  },
  footer: {
    paddingTop: spacing.md,
  },
});
