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
 * 4. 长按卡片 = 进入多选合并模式（iOS 列表惯例：长按一项立刻进入选择模式
 *    并勾选该项）。多选模式下 SwipeRow 禁用、滚动正常。
 * 5. 列表分两组：🔔 有提醒 / 无提醒。有提醒组内过期置顶、未过期按时间升序；
 *    无提醒组内按 sort_order + updated_at 排。归组完全由 reminder.enabled 决定，
 *    编辑页改开关后 React 自动 diff 让卡片滑到正确组。
 */

import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useCallback, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { sharePlanFile } from '../ai/planShare';
import {
  AppText,
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
import { getPlanById } from '../db';
import { usePlanStore } from '../store/planStore';
import { colors, spacing } from '../theme';
import type { PlanSummary, Step } from '../types';
import { createId } from '../utils/id';

export default function PlanListScreen() {
  const router = useRouter();

  // 滑动行互斥：滑开第二条时第一条自动收起（主流 App 惯例）
  const openRowRef = useRef<SwipeableMethods | null>(null);
  const handleRowOpened = useCallback((methods: SwipeableMethods) => {
    openRowRef.current?.close();
    openRowRef.current = methods;
  }, []);
  const handleRowClosed = useCallback(() => {
    openRowRef.current = null;
  }, []);

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
  const deletePlans = usePlanStore((state) => state.deletePlans);

  /** 正在读取的卡片 id，用于避免连点打开两条任务链。 */
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PlanSummary | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);

  // ── 多选合并 ──────────────────────────────────────────────────────
  // selectedIds 用数组而不用 Set：下标 + 1 就是卡片上显示的勾选顺序号，
  // 取消某一项后数组重排，后续项的顺序号自然前移，不需要额外维护编号。
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** 批量删除确认：'selected' = 删勾选，'all' = 清空全部。 */
  const [pendingBulkDelete, setPendingBulkDelete] = useState<null | 'selected' | 'all'>(null);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }, []);

  const exitSelecting = useCallback(() => {
    setSelecting(false);
    setSelectedIds([]);
  }, []);

  const allSelected = plans.length > 0 && selectedIds.length === plans.length;

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((current) =>
      current.length === plans.length ? [] : plans.map((p) => p.id),
    );
  }, [plans]);

  /** 批量删除确认框的"确认"分支：删勾选 / 清空全部共用一个出口。 */
  const confirmBulkDelete = useCallback(() => {
    const action = pendingBulkDelete;
    setPendingBulkDelete(null);
    if (action === null) {
      return;
    }
    const ids = action === 'all' ? plans.map((p) => p.id) : selectedIds;
    exitSelecting();
    void deletePlans(ids);
  }, [deletePlans, exitSelecting, pendingBulkDelete, plans, selectedIds]);

  /** "过期"判断的时间基准：只能在 effect 里取（渲染期调 Date.now 违反纯度规则），
   *  页面每次获得焦点时刷新一次即可 —— 列表本来就是 focus 时重新加载的。 */
  const [nowMs, setNowMs] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setNowMs(Date.now());
    }, []),
  );

  /** 按勾选顺序取出完整任务链，拼成一个新草稿进编辑器（不落库）。 */
  const mergeSelected = useCallback(() => {
    if (selectedIds.length < 2) {
      return;
    }
    void (async () => {
      // 与导出同理：直接从数据层读，不碰 store 的 activePlan
      const plans = (
        await Promise.all(selectedIds.map((id) => getPlanById(id)))
      ).filter((plan) => plan !== null);

      if (plans.length < 2) {
        setNotice({ title: '无法合并', message: '部分任务链已被删除，请重新选择。' });
        await loadPlans();
        return;
      }

      // 步骤重新生成 id 并按勾选顺序重排：沿用旧 id 可能撞 key，
      // order 交给编辑器的归一化逻辑按下标兜底
      const steps: Step[] = plans
        .flatMap((plan) => plan.steps)
        .map((step, index) => ({ ...step, id: createId('step'), order: index }));

      const title = plans
        .map((plan) => plan.title)
        .join(' + ')
        .slice(0, 60);

      exitSelecting();
      router.push({
        pathname: '/edit',
        params: { draft: JSON.stringify({ id: null, title, steps }) },
      });
    })();
  }, [exitSelecting, loadPlans, router, selectedIds]);

  // 每次回到本页都重新读一次：编辑页保存后返回，列表必须立刻反映最新数据。
  useFocusEffect(
    useCallback(() => {
      void loadPlans();
    }, [loadPlans]),
  );

  // ── 物理返回键拦截（根页退出确认） ──────────────────────────────────
  // Android 硬件返回在根 Tab 上默认会"返回桌面"，太突然。这里弹确认，
  // 连续两次点才真退出 —— 和主流 App（微信、Gmail、网易云）一致的惯例。
  useFocusEffect(
    useCallback(() => {
      let handledOnce = false;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (handledOnce) {
          // 第二次拦截：放行（App 正常退出）
          return false;
        }
        handledOnce = true;
        setNotice({ title: '再按一次退出', message: '当前页是首页。' });
        // 2 秒内没按第二次就重置
        setTimeout(() => {
          handledOnce = false;
        }, 2000);
        return true;
      });
      return () => subscription.remove();
    }, []),
  );

  /** 进入编辑器（左滑"编辑"的入口，不走 store 的 activePlan）。 */
  const editPlan = useCallback((id: string) => {
    void router.push(`/edit?id=${id}`);
  }, [router]);

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

  const requestShare = useCallback((item: PlanSummary) => {
    // 列表只有摘要，导出需要完整步骤 —— 直接从数据层读，避免污染 store
    // 的 activePlan（理由与编辑器一致：可能正有另一条链在执行）。
    void (async () => {
      try {
        const plan = await getPlanById(item.id);
        if (plan === null) {
          setNotice({ title: '任务不存在', message: '这条任务链可能已经被删除了。' });
          return;
        }
        await sharePlanFile(plan);
      } catch {
        setNotice({ title: '导出失败', message: '文件分享没有完成，请重试。' });
      }
    })();
  }, []);

  /**
   * 长按进多选后的"幽灵点击"抑制：松手那一刻 Pressable 会补发一次 onPress，
   * 把刚勾上的项又勾掉（用户感知是"点了两次"）。长按时记下任务 id，
   * 吞掉它接下来的一次 onPress。
   */
  const suppressPressId = useRef<string | null>(null);

  const renderItem = useCallback(
    ({ item }: { item: PlanSummary }) => {
      const order = selectedIds.indexOf(item.id) + 1;
      return (
        <View style={styles.cardWrap}>
          <SwipeRow
            enabled={!selecting}
            onDelete={() => requestDelete(item)}
            onShare={() => requestShare(item)}
            onEdit={() => editPlan(item.id)}
            openOther={() => openRowRef.current?.close()}
            onOpened={handleRowOpened}
            onClosed={handleRowClosed}
          >
            <View style={styles.selectRow}>
              {selecting ? (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: order > 0 }}
                  accessibilityLabel={`选择「${item.title}」`}
                  hitSlop={spacing.sm}
                  onPress={() => toggleSelect(item.id)}
                  style={[styles.orderBadge, order > 0 ? styles.orderBadgeActive : null]}
                >
                  {order > 0 ? (
                    <AppText variant="captionStrong" color="textOnPrimary">
                      {order}
                    </AppText>
                  ) : null}
                </Pressable>
              ) : null}
              <View style={styles.cardFlex}>
                <PlanCard
                  summary={item}
                  running={item.id === runningPlanId}
                  nowMs={nowMs}
                  onPress={() => {
                    // 长按手势的松手补发的 onPress：吞掉，别当成"取消勾选"
                    if (suppressPressId.current === item.id) {
                      suppressPressId.current = null;
                      return;
                    }
                    if (selecting) {
                      toggleSelect(item.id);
                    } else {
                      openPlan(item.id);
                    }
                  }}
                  // 长按 = 进入多选模式（iOS 列表惯例：长按一项立刻进入选择模式并勾选该项）
                  onLongPress={
                    selecting
                      ? undefined
                      : () => {
                          suppressPressId.current = item.id;
                          setSelecting(true);
                          setSelectedIds([item.id]);
                        }
                  }
                />
              </View>
            </View>
          </SwipeRow>
        </View>
      );
    },
    [editPlan, nowMs, openPlan, requestDelete, requestShare, runningPlanId, selectedIds, selecting, toggleSelect],
  );

  /** 把 plans 分成两组：有提醒 / 无提醒。
   *   有提醒组内：过期置顶，未过期按 scheduledFor ASC（最近的在最前）。
   *   无提醒组内：按 sort_order ASC, updated_at DESC。
   *   整个分组逻辑依赖 reminder.enabled + scheduledFor，编辑页改了开关后 store loadPlans()
   *   会触发 re-render，useMemo 自动重算，SectionList 的 key 是 plan.id，React 自动 diff
   *   让卡片"滑"到正确的组 —— 零手动维护成本。 */
  const sections = useMemo(() => {
    const scheduled: PlanSummary[] = [];
    const unscheduled: PlanSummary[] = [];
    for (const p of plans) {
      if (p.reminder?.enabled) {
        scheduled.push(p);
      } else {
        unscheduled.push(p);
      }
    }
    const now = nowMs;
    scheduled.sort((a, b) => {
      const aMs = a.reminder?.scheduledFor ?? Number.POSITIVE_INFINITY;
      const bMs = b.reminder?.scheduledFor ?? Number.POSITIVE_INFINITY;
      // 过期置顶（status = 'past' 排前面）
      const aPast = aMs < now ? 0 : 1;
      const bPast = bMs < now ? 0 : 1;
      if (aPast !== bPast) return aPast - bPast;
      return aMs - bMs;
    });
    unscheduled.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return b.updatedAt - a.updatedAt;
    });

    const arr: { key: string; title: string; data: PlanSummary[] }[] = [];
    if (scheduled.length > 0) arr.push({ key: 'schedule', title: '🔔 有提醒', data: scheduled });
    if (unscheduled.length > 0) arr.push({ key: 'noschedule', title: '无提醒', data: unscheduled });
    return arr;
  }, [nowMs, plans]);

  return (
    <Screen variant="grouped">
      <Header
        title={selecting ? `已选 ${selectedIds.length} 个` : 'TimerChain'}
        subtitle={selecting ? '按勾选顺序合并步骤' : '把一段专注拆成一条链'}
        right={
          <View style={styles.headerActions}>
            {selecting ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={allSelected ? '取消全选' : '全选'}
                  hitSlop={spacing.sm}
                  onPress={toggleSelectAll}
                >
                  <AppText variant="body" color="primary">
                    {allSelected ? '全不选' : '全选'}
                  </AppText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="清空全部任务"
                  hitSlop={spacing.sm}
                  onPress={() => setPendingBulkDelete('all')}
                >
                  <AppText variant="body" color="danger">
                    清空
                  </AppText>
                </Pressable>
              </>
            ) : null}
            <IconButton
              name={selecting ? 'close-outline' : 'checkbox-outline'}
              accessibilityLabel={selecting ? '退出多选' : '多选合并'}
              onPress={selecting ? exitSelecting : () => setSelecting(true)}
            />
            {selecting ? null : (
              <IconButton
                name="settings-outline"
                accessibilityLabel="设置"
                onPress={() => router.push('/settings')}
              />
            )}
          </View>
        }
      />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => renderItem({ item })}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <AppText variant="overline" color="textSecondary">
              {section.title}
            </AppText>
          </View>
        )}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          plans.length === 0 ? renderEmptyState(listStatus, listError, loadPlans) : undefined
        }
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.footer}>
        {selecting ? (
          <View style={styles.footerRow}>
            <View style={styles.footerCell}>
              <Button
                label={selectedIds.length === 0 ? '删除' : `删除 ${selectedIds.length} 个`}
                icon="trash-outline"
                variant="danger"
                size="lg"
                fullWidth
                disabled={selectedIds.length === 0}
                onPress={() => setPendingBulkDelete('selected')}
              />
            </View>
            <View style={styles.footerCell}>
              <Button
                label={
                  selectedIds.length < 2 ? '勾选至少 2 个' : `合并 ${selectedIds.length} 个`
                }
                icon="git-merge-outline"
                size="lg"
                fullWidth
                disabled={selectedIds.length < 2}
                onPress={mergeSelected}
              />
            </View>
          </View>
        ) : (
          <>
            <Button
              label="新建任务"
              icon="add"
              size="lg"
              fullWidth
              onPress={() => router.push('/edit')}
            />
            <Button
              label="用一段文字生成（AI）"
              icon="sparkles-outline"
              variant="ghost"
              fullWidth
              onPress={() => router.push('/ai-import')}
            />
            <Button
              label="导入任务文件"
              icon="download-outline"
              variant="ghost"
              fullWidth
              onPress={() => router.push('/import')}
            />
          </>
        )}
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
        visible={pendingBulkDelete !== null}
        title={
          pendingBulkDelete === 'all'
            ? '清空全部任务？'
            : `删除 ${selectedIds.length} 个任务？`
        }
        message={
          pendingBulkDelete === 'all'
            ? `将删除全部 ${plans.length} 条任务链及其提醒，不可恢复。` +
              (runningPlanId !== null ? '其中包含正在执行的任务，删除会立即终止它。' : '')
            : (runningPlanId !== null && selectedIds.includes(runningPlanId)
                ? '其中包含正在执行的任务，删除会立即终止它。'
                : '删除后不可恢复。')
        }
        confirmLabel={pendingBulkDelete === 'all' ? '全部删除' : '删除'}
        tone="danger"
        onCancel={() => setPendingBulkDelete(null)}
        onConfirm={confirmBulkDelete}
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
    paddingBottom: spacing.xl,
  },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  cardWrap: {
    marginBottom: spacing.md,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cardFlex: {
    flex: 1,
  },
  orderBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  orderBadgeActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  footer: {
    paddingTop: spacing.md,
  },
  footerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  footerCell: {
    flex: 1,
  },
});
