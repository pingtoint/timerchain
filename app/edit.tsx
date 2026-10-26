/**
 * 任务链编辑器。
 *
 * ── 这一页的复杂度来自三件事 ────────────────────────────────────────
 * 1. 拖拽排序（手动手柄驱动，不靠整行长按，否则和"点输入框改字"会打架）；
 * 2. 步骤是"就地编辑"的：改一个字就更新草稿，没有"编辑态/预览态"之分；
 * 3. 校验结果要同时驱动三处 —— 保存按钮的置灰、字段内的红字、以及
 *    一个说明"到底哪里没填"的弹窗（字段滚出屏幕时，红字是看不见的）。
 *
 * ── 一个刻意的架构选择 ─────────────────────────────────────────────
 * 读任务链**不走 store 的 loadPlanById**，而是直接用数据层的 getPlanById。
 * 原因：store 的 loadPlanById 会把读到的对象写进 `activePlan`，而 `activePlan`
 * 正是执行页正在消费的数据。用户"一边跑 A，一边改 B"是正常操作，
 * 编辑器把 activePlan 覆盖掉会让正在跑的计时器显示成另一条链的步骤。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import DraggableFlatList, {
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

import {
  AppText,
  Button,
  Dialog,
  Header,
  IconButton,
  ReminderRow,
  Screen,
  StateView,
  StepCard,
  TextField,
} from '../components';
import { getPlanById } from '../db';
import { useAlertSoundPreview } from '../hooks/useAlert';
import { usePlanStore } from '../store/planStore';
import { spacing } from '../theme';
import type { ReminderConfig, SavePlanInput, Step } from '../types';
import { createId } from '../utils/id';
import { formatApproxDuration, toErrorMessage } from '../utils/format';
import {
  createEmptyStep,
  normalizePlanDraft,
  planTotalDurationSec,
  validatePlanDraft,
  type PlanDraftErrors,
} from '../utils/plan';

function createNewDraft(): SavePlanInput {
  return { id: null, title: '', steps: [createEmptyStep(0)], reminder: null };
}

const serialize = (draft: SavePlanInput): string => JSON.stringify(draft);

/**
 * 解析路由传入的草稿（合并任务的入口）。
 * 形状不对时静默回退到空白草稿 —— 参数可能被手工构造，不能信任。
 */
function parseDraftParam(raw: string | undefined): SavePlanInput | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as SavePlanInput).steps) &&
      (parsed as SavePlanInput).steps.length > 0 &&
      typeof (parsed as SavePlanInput).title === 'string'
    ) {
      // 一律视为新建：合并产生的是一条新任务链，不覆盖任何已有数据
      return {
        id: null,
        title: (parsed as SavePlanInput).title,
        steps: (parsed as SavePlanInput).steps,
        reminder: (parsed as SavePlanInput).reminder ?? null,
      };
    }
  } catch {
    // 落到下面的 null
  }
  return null;
}

export default function PlanEditorScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; draft?: string }>();
  const editingId = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;

  const savePlan = usePlanStore((state) => state.savePlan);
  const previewSound = useAlertSoundPreview();

  const [draft, setDraft] = useState<SavePlanInput>(
    () => parseDraftParam(params.draft) ?? createNewDraft(),
  );
  /** 载入时的快照。用来判断"有没有未保存的修改"。 */
  const baselineRef = useRef<string>(serialize(draft));

  const [loading, setLoading] = useState(editingId !== null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 只有点过保存后才把红字显示出来，避免用户一进来就看到一片报错。 */
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [exitVisible, setExitVisible] = useState(false);
  const repeatRef = useRef<(() => void) | null>(null);

  /**
   * "是否有未保存改动"的双重判定：
   * 1. 显式改动：序列化草稿 ≠ 载入快照
   * 2. 隐式改动：带 draft 参数进来（合并任务 / AI 导入）—— 这条链还没真正落库，
   *    就算用户啥都没改就返回，也应该拦截，否则辛辛苦苦合并出来的草稿丢了没处找。
   */
  const hasDraftParam =
    typeof params.draft === 'string' && params.draft.length > 0 && parseDraftParam(params.draft) !== null;
  const dirty = serialize(draft) !== baselineRef.current || (editingId === null && hasDraftParam);

  // ── 载入已有的任务链 ────────────────────────────────────────────
  useEffect(() => {
    if (editingId === null) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const plan = await getPlanById(editingId);
        if (cancelled) {
          return;
        }
        if (plan === null) {
          setLoadError('这条任务链已经不存在了，可能已被删除。');
          return;
        }
        const loaded: SavePlanInput = {
          id: plan.id,
          title: plan.title,
          steps: plan.steps,
          reminder: plan.reminder,
        };
        baselineRef.current = serialize(loaded);
        setDraft(loaded);
      } catch (error) {
        if (!cancelled) {
          setLoadError(toErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editingId]);

  // ── 离开保护：有未保存修改时先确认 ──────────────────────────────
  const disablePrevention = usePreventRemove(dirty, ({ repeat }) => {
    repeatRef.current = repeat;
    setExitVisible(true);
  });

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [router]);

  const discardAndLeave = useCallback(() => {
    setExitVisible(false);
    const repeat = repeatRef.current;
    repeatRef.current = null;
    if (repeat !== null) {
      repeat();
      return;
    }
    disablePrevention();
    goBack();
  }, [disablePrevention, goBack]);

  const requestExit = useCallback(() => {
    if (dirty) {
      setExitVisible(true);
      return;
    }
    goBack();
  }, [dirty, goBack]);

  // ── 步骤操作 ────────────────────────────────────────────────────
  const updateStep = useCallback((stepId: string, patch: Partial<Step>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    }));
  }, []);

  const removeStep = useCallback((stepId: string) => {
    setDraft((current) => {
      // 规格：至少保留 1 个步骤
      if (current.steps.length <= 1) {
        return current;
      }
      const remaining = current.steps.filter((step) => step.id !== stepId);
      return {
        ...current,
        steps: remaining.map((step, index) => ({ ...step, order: index })),
      };
    });
  }, []);

  const addStep = useCallback(() => {
    setDraft((current) => ({
      ...current,
      steps: [...current.steps, createEmptyStep(current.steps.length)],
    }));
  }, []);

  /** 复制一步，插在当前步之后。重新生成 id 避免撞 key。 */
  const duplicateStep = useCallback((stepId: string) => {
    setDraft((current) => {
      const index = current.steps.findIndex((s) => s.id === stepId);
      if (index === -1) {
        return current;
      }
      const source = current.steps[index];
      const copy: Step = {
        ...source,
        id: createId('step'),
        order: source.order + 0.5, // 后面 normalize 会按下标重排
      };
      const next = [...current.steps];
      next.splice(index + 1, 0, copy);
      return {
        ...current,
        steps: next.map((s, i) => ({ ...s, order: i })),
      };
    });
  }, []);

  const updateReminder = useCallback((next: ReminderConfig | null) => {
    setDraft((current) => ({ ...current, reminder: next }));
  }, []);

  /** 折叠状态：默认有描述的步骤展开，否则收起。 */
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() =>
    parseDraftParam(params.draft)?.steps.reduce<Record<string, boolean>>(
      (acc, s) => ({ ...acc, [s.id]: s.content.length > 0 }),
      {},
    ) ?? { _default: true },
  );

  // 载入已有任务链后，同步 expandedMap
  useEffect(() => {
    if (editingId === null) {
      return;
    }
    // draft 变化后重新基于 steps 生成
    setExpandedMap((prev) => {
      const next: Record<string, boolean> = {};
      for (const step of draft.steps) {
        next[step.id] = prev[step.id] ?? step.content.length > 0;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.steps]);

  const toggleStepExpanded = useCallback((stepId: string) => {
    setExpandedMap((prev) => ({ ...prev, [stepId]: !(prev[stepId] ?? false) }));
  }, []);

  const setAllExpanded = useCallback(() => {
    setExpandedMap(draft.steps.reduce<Record<string, boolean>>((acc, s) => ({ ...acc, [s.id]: true }), {}));
  }, [draft.steps]);

  const setAllCollapsed = useCallback(() => {
    setExpandedMap(draft.steps.reduce<Record<string, boolean>>((acc, s) => ({ ...acc, [s.id]: false }), {}));
  }, [draft.steps]);

  /** 拖拽结束后按下标重排 order。order 必须等于下标，否则落库顺序会错乱。 */
  const reorderSteps = useCallback((data: Step[]) => {
    setDraft((current) => ({
      ...current,
      steps: data.map((step, index) => ({ ...step, order: index })),
    }));
  }, []);

  // ── 派生数据 ────────────────────────────────────────────────────
  const validation = useMemo(() => validatePlanDraft(draft), [draft]);
  const totalDurationSec = useMemo(() => planTotalDurationSec(draft), [draft]);
  const titleEmpty = draft.title.trim().length === 0;
  const stepCount = draft.steps.length;
  const saveDisabled = titleEmpty || stepCount === 0 || saving || loading;

  const handleSave = useCallback(() => {
    if (saveDisabled) {
      return;
    }

    const result = validatePlanDraft(draft);
    if (!result.valid) {
      // 红字只能提示"看得见的那个字段"。如果有问题的步骤被滚出了屏幕，
      // 用户会以为按钮坏了 —— 所以同时给一个说清楚问题的弹窗。
      setShowErrors(true);
      setProblem(describeErrors(draft, result.errors));
      return;
    }

    setSaving(true);
    void (async () => {
      try {
        const normalized = normalizePlanDraft(draft);
        await savePlan(normalized);
        // 保存成功后 draft 与 baseline 的差异已经落库，离开时不必再确认
        baselineRef.current = serialize(draft);
        disablePrevention();
        goBack();
      } catch (error) {
        setProblem(toErrorMessage(error));
      } finally {
        setSaving(false);
      }
    })();
  }, [disablePrevention, draft, goBack, saveDisabled, savePlan]);

  // ── 渲染 ────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<Step>) => {
      const index = getIndex() ?? 0;
      return (
        <View style={styles.stepWrap}>
          <StepCard
            index={index}
            step={item}
            isLast={index === stepCount - 1}
            errors={showErrors ? validation.errors.stepFields[item.id] : undefined}
            canRemove={stepCount > 1}
            isActive={isActive}
            onDrag={drag}
            onChange={(patch) => updateStep(item.id, patch)}
            onRemove={() => removeStep(item.id)}
            onDuplicate={() => duplicateStep(item.id)}
            onPreviewSound={previewSound}
            expanded={expandedMap[item.id] ?? item.content.length > 0}
            onToggleExpand={() => toggleStepExpanded(item.id)}
          />
        </View>
      );
    },
    [
      duplicateStep,
      expandedMap,
      previewSound,
      removeStep,
      showErrors,
      stepCount,
      toggleStepExpanded,
      updateStep,
      validation.errors.stepFields,
    ],
  );

  /** Header 右侧按钮文案：如果至少有一个步骤没展开，就显示"全部展开"，否则显示"全部收起"。 */
  const allExpanded = useMemo(() => {
    for (const step of draft.steps) {
      if (!(expandedMap[step.id] ?? step.content.length > 0)) {
        return false;
      }
    }
    return true;
  }, [draft.steps, expandedMap]);

  const listHeader = (
    <View style={styles.headerBlock}>
      <TextField
        variant="title"
        value={draft.title}
        onChangeText={(title) => setDraft((current) => ({ ...current, title }))}
        placeholder="任务名称"
        error={showErrors ? validation.errors.title ?? null : null}
        hint={titleEmpty ? '给这条任务链起个名字，例如「深度工作 50 分钟」' : undefined}
        returnKeyType="done"
        maxLength={60}
      />

      <View style={styles.metaRow}>
        <AppText variant="caption" color="textSecondary">
          {stepCount} 步 · 约 {formatApproxDuration(totalDurationSec)}
        </AppText>
        <AppText variant="caption" color="textDisabled">
          长按步骤左侧手柄可拖动排序
        </AppText>
      </View>

      <ReminderRow value={draft.reminder ?? null} onChange={updateReminder} />
    </View>
  );

  return (
    <Screen variant="plain">
      <Header
        title={draft.title.trim().length > 0 ? draft.title : editingId === null ? '新建任务' : '编辑任务'}
        subtitle={`${stepCount} 步 · 约 ${formatApproxDuration(totalDurationSec)}`}
        onBack={requestExit}
        right={
          <IconButton
            name={allExpanded ? 'contract-outline' : 'expand-outline'}
            accessibilityLabel={allExpanded ? '全部收起' : '全部展开'}
            onPress={() => (allExpanded ? setAllCollapsed() : setAllExpanded())}
          />
        }
      />

      {loading ? (
        <StateView variant="loading" description="正在读取任务链" />
      ) : loadError === null ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={spacing.lg}
        >
          <DraggableFlatList
            data={draft.steps}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            onDragEnd={({ data }) => reorderSteps(data)}
            ListHeaderComponent={listHeader}
            containerStyle={styles.flex}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />

          <View style={styles.footer}>
            <Button
              label="添加步骤"
              icon="add"
              variant="secondary"
              size="lg"
              style={styles.footerButton}
              onPress={addStep}
            />
            <Button
              label="保存"
              icon="checkmark"
              size="lg"
              style={styles.footerButton}
              disabled={saveDisabled}
              loading={saving}
              onPress={handleSave}
            />
          </View>
        </KeyboardAvoidingView>
      ) : (
        <StateView
          variant="error"
          description={loadError}
          onRetry={() => router.replace('/')}
          retryLabel="返回列表"
        />
      )}

      <Dialog
        visible={exitVisible}
        title="放弃未保存的修改？"
        message="这一步之后的内容不会被保存。"
        confirmLabel="放弃并返回"
        cancelLabel="继续编辑"
        tone="danger"
        onCancel={() => {
          repeatRef.current = null;
          setExitVisible(false);
        }}
        onConfirm={discardAndLeave}
      />

      <Dialog
        visible={problem !== null}
        title="还不能保存"
        message={problem ?? undefined}
        confirmLabel="知道了"
        cancelLabel={null}
        onCancel={() => setProblem(null)}
        onConfirm={() => setProblem(null)}
      />
    </Screen>
  );
}

/**
 * 把校验结果翻译成一句人话，并带上步骤序号。
 *
 * `errors.stepFields` 的 key 是 step.id，而用户脑子里记的是"第 3 步"，
 * 所以必须回查下标 —— 直接把 id 打给用户看等于没说。
 */
function describeErrors(draft: SavePlanInput, errors: PlanDraftErrors): string {
  if (errors.title !== undefined) {
    return errors.title;
  }
  if (errors.steps !== undefined) {
    return errors.steps;
  }

  for (const [stepId, fieldErrors] of Object.entries(errors.stepFields)) {
    const index = draft.steps.findIndex((step) => step.id === stepId);
    const label = index >= 0 ? `第 ${index + 1} 步` : '有步骤';
    if (fieldErrors.title !== undefined) {
      return `${label}的标题不能为空。`;
    }
    if (fieldErrors.durationSec !== undefined) {
      return `${label}的时长不能为 0。`;
    }
  }

  return '请检查任务名称与每一步的标题、时长。';
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  headerBlock: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  metaRow: {
    gap: spacing.xs,
  },
  stepWrap: {
    marginBottom: spacing.md,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  footerButton: {
    flex: 1,
  },
});
