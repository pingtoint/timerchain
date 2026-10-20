/**
 * 任务链的领域逻辑：草稿构造、归一化、校验。
 *
 * 之所以单独成文件而不是塞进编辑器页面：这三件事同时被
 * 「编辑器（实时置灰保存按钮）」「store（保存前归一化）」「数据层（落库前兜底）」
 * 消费，写在页面里必然出现三份各不相同的实现。
 */

import {
  STEP_LIMITS,
  type Plan,
  type SavePlanInput,
  type Step,
} from '../types';
import { clamp } from './format';
import { createId } from './id';

/** 新建一个空步骤。`order` 会由归一化逻辑按数组下标重排，这里只是占位。 */
export function createEmptyStep(order: number): Step {
  return {
    id: createId('step'),
    order,
    title: '',
    content: '',
    durationSec: 5 * 60, // 默认 5 分钟：比 10 秒更接近"一段专注"的心理预期
    restAfterSec: 60, // 默认停歇 1 分钟；最后一步会被归一化强制置 0
    alertSound: 'chime',
    videoUrl: null,
  };
}

/**
 * 归一化：把编辑态草稿整理成可以直接落库的形状。
 *
 * - 标题、内容去除首尾空格（规格 D）
 * - order 严格等于数组下标，杜绝拖拽后 order 错乱
 * - 时长夹取到合法区间（规格 D: 时长不能为 0）
 * - **最后一步的停歇强制为 0**（规格：最后一步不需要休息）
 */
export function normalizePlanDraft(input: SavePlanInput): SavePlanInput {
  const lastIndex = input.steps.length - 1;

  const steps = input.steps.map((step, index) => ({
    ...step,
    order: index,
    title: step.title.trim(),
    content: step.content.trim(),
    durationSec: clamp(
      Math.round(step.durationSec),
      STEP_LIMITS.durationMinSec,
      STEP_LIMITS.durationMaxSec,
    ),
    restAfterSec:
      index === lastIndex
        ? 0
        : clamp(Math.round(step.restAfterSec), STEP_LIMITS.restMinSec, STEP_LIMITS.restMaxSec),
    videoUrl: step.videoUrl ?? null,
  }));

  return {
    id: input.id,
    title: input.title.trim(),
    steps,
  };
}

export interface PlanDraftErrors {
  title?: string;
  steps?: string;
  /** key 为 step.id，值为该步骤的错误文案。 */
  stepFields: Record<string, { title?: string; durationSec?: string }>;
}

export interface PlanDraftValidation {
  valid: boolean;
  errors: PlanDraftErrors;
}

/**
 * 校验草稿。规格 D 的四条规则集中在这里，编辑器只负责把结果显示出来。
 *
 * 注意：校验的是**归一化之后**的数据，这样"标题只有空格"也会被判为非法。
 */
export function validatePlanDraft(input: SavePlanInput): PlanDraftValidation {
  const normalized = normalizePlanDraft(input);
  const errors: PlanDraftErrors = { stepFields: {} };

  if (normalized.title.length === 0) {
    errors.title = '任务名称不能为空';
  }

  if (normalized.steps.length === 0) {
    errors.steps = '至少需要 1 个步骤';
  }

  normalized.steps.forEach((step) => {
    const fieldErrors: { title?: string; durationSec?: string } = {};
    if (step.title.length === 0) {
      fieldErrors.title = '步骤标题不能为空';
    }
    if (step.durationSec <= 0) {
      fieldErrors.durationSec = '时长不能为 0';
    }
    if (fieldErrors.title !== undefined || fieldErrors.durationSec !== undefined) {
      errors.stepFields[step.id] = fieldErrors;
    }
  });

  const valid =
    errors.title === undefined &&
    errors.steps === undefined &&
    Object.keys(errors.stepFields).length === 0;

  return { valid, errors };
}

/** 任务链总时长（含停歇），列表页与执行页共用同一口径。 */
export function planTotalDurationSec(plan: Pick<Plan, 'steps'>): number {
  return plan.steps.reduce((sum, step) => sum + step.durationSec + step.restAfterSec, 0);
}
