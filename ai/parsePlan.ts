/**
 * AI 返回内容的容错解析：任意文本 → SavePlanInput 草稿。
 *
 * ── 容错的三层防线 ─────────────────────────────────────────────────
 * 1. 提取：AI 经常不遵守"只输出 JSON"的约定 —— 带 markdown 围栏、
 *    前后带解释文字。这里先剥围栏，再截取第一个 { 到最后一个 }。
 * 2. 字段别名：模型可能输出 duration / minutes / durationSec 等各种
 *    键名，统一映射到模板的规范字段，分钟一律换算成秒。
 * 3. 兜底默认值：空标题补「步骤 N」、缺提醒音补 chime，保证产物
 *    一定能通过 utils/plan.ts 的校验，可以直接落库或进编辑器微调。
 */

import type { AlertSound, SavePlanInput, Step } from '../types';
import { createEmptyStep, normalizePlanDraft, validatePlanDraft } from '../utils/plan';

export type ParsePlanResult =
  | { ok: true; draft: SavePlanInput }
  | { ok: false; error: string };

const VALID_SOUNDS: readonly AlertSound[] = ['chime', 'beep', 'none'];

/** 单步数量上限：防止 AI 失控输出几百步把数据库撑爆。 */
const MAX_STEPS = 50;

/** AI 输出里常见的分钟键名，按优先级排列。 */
const DURATION_MIN_KEYS = ['durationMin', 'duration_min', 'minutes', 'minute', 'duration'] as const;
/** 秒级键名单独处理：值要除以 60。 */
const DURATION_SEC_KEYS = ['durationSec', 'duration_sec', 'seconds'] as const;
const REST_MIN_KEYS = ['restMin', 'rest_min', 'rest'] as const;
const REST_SEC_KEYS = ['restAfterSec', 'rest_after_sec', 'restSec', 'rest_sec'] as const;
const TITLE_KEYS = ['title', 'name', 'label'] as const;
const CONTENT_KEYS = ['content', 'description', 'note', 'notes', 'detail'] as const;
const MODE_KEYS = ['mode', 'kind', 'stepKind', 'step_kind', 'type'] as const;
const REPEAT_COUNT_KEYS = ['repeatCount', 'repeat_count', 'rounds', 'repeat', 'times'] as const;
const REPEAT_GAP_SEC_KEYS = [
  'repeatGapSec',
  'repeat_gap_sec',
  'gapSec',
  'gap_sec',
  'repeatRestSec',
  'repeat_rest_sec',
] as const;

export function parsePlanJson(raw: string): ParsePlanResult {
  const jsonText = extractJson(raw);
  if (jsonText === null) {
    return { ok: false, error: '没有找到 JSON 内容。请确认粘贴的是 AI 的完整回复。' };
  }

  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: 'JSON 格式有误，无法解析。可以重新生成一次，或把回复原样粘贴（不要截断）。' };
  }

  // 容忍两种包装：直接是步骤数组，或包了一层 { plan: {...} }
  let container: Record<string, unknown>;
  if (Array.isArray(data)) {
    container = { title: '', steps: data };
  } else if (isRecord(data) && isRecord(data.plan)) {
    container = data.plan;
  } else if (isRecord(data)) {
    container = data;
  } else {
    return { ok: false, error: 'JSON 结构不是任务链对象。' };
  }

  const rawSteps = Array.isArray(container.steps) ? container.steps : null;
  if (rawSteps === null || rawSteps.length === 0) {
    return { ok: false, error: '任务链里没有任何步骤（steps 为空）。' };
  }
  if (rawSteps.length > MAX_STEPS) {
    return { ok: false, error: `步骤数量超过 ${MAX_STEPS} 个，请精简描述后重新生成。` };
  }

  const title = readString(container, TITLE_KEYS).trim() || '未命名任务';
  const steps = rawSteps.map((rawStep, index) => toStep(rawStep, index));

  const draft = normalizePlanDraft({ id: null, title, steps });
  const validation = validatePlanDraft(draft);
  if (!validation.valid) {
    // 经过兜底默认值的草稿理论上必然合法；走到这里说明出现了没预料的脏数据，
    // 与其猜原因，不如让用户重新生成一次。
    return { ok: false, error: '生成的内容不完整，请让 AI 重新生成一次。' };
  }

  return { ok: true, draft };
}

/** 剥 markdown 围栏并截取首个 JSON 对象；找不到返回 null。 */
function extractJson(raw: string): string | null {
  let text = raw.trim();
  if (text.length === 0) {
    return null;
  }

  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenceMatch !== null && fenceMatch[1] !== undefined) {
    text = fenceMatch[1].trim();
  }

  const start = text.indexOf('{');
  const arrayStart = text.indexOf('[');
  // 根节点可能是数组：取两种括号中更靠前的那个
  const actualStart =
    start === -1 ? arrayStart : arrayStart === -1 ? start : Math.min(start, arrayStart);
  if (actualStart === -1) {
    return null;
  }
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end <= actualStart) {
    return null;
  }
  return text.slice(actualStart, end + 1);
}

function toStep(raw: unknown, index: number): Step {
  const base = createEmptyStep(index);
  if (!isRecord(raw)) {
    // 步骤不是对象（比如是字符串）：保留标题信息的最后机会
    return {
      ...base,
      title: typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : `步骤 ${index + 1}`,
    };
  }

  const durationSec = readMinutesAsSeconds(raw, DURATION_MIN_KEYS, DURATION_SEC_KEYS);
  const restSec = readMinutesAsSeconds(raw, REST_MIN_KEYS, REST_SEC_KEYS);
  const repeatCount = readInt(raw, REPEAT_COUNT_KEYS);
  const repeatGapSec = readInt(raw, REPEAT_GAP_SEC_KEYS);
  const soundRaw = readString(raw, ['alertSound', 'alert_sound', 'sound'] as const).toLowerCase();
  const alertSound = (VALID_SOUNDS as readonly string[]).includes(soundRaw)
    ? (soundRaw as AlertSound)
    : base.alertSound;
  // mode 缺省时：给了遍数（>1）且没给时长 → 视为计次步骤；否则计时
  const modeRaw = readString(raw, MODE_KEYS).toLowerCase();
  const isCount =
    modeRaw === 'count' ||
    modeRaw === 'reps' ||
    (modeRaw === '' && (repeatCount ?? 1) > 1 && durationSec === null);

  return {
    ...base,
    title: readString(raw, TITLE_KEYS).trim() || `步骤 ${index + 1}`,
    content: readString(raw, CONTENT_KEYS).trim(),
    kind: isCount ? 'count' : 'timed',
    durationSec: isCount ? 0 : (durationSec ?? base.durationSec),
    restAfterSec: restSec ?? base.restAfterSec,
    repeatCount: isCount ? (repeatCount ?? base.repeatCount) : 1,
    // 间隙只有"次数 > 1"才有意义，否则强制 0（与归一化逻辑同口径）
    repeatRestSec:
      isCount && (repeatCount ?? base.repeatCount) > 1 ? (repeatGapSec ?? 0) : 0,
    alertSound,
  };
}

/** 读取整数字段；读不到或不是有限数返回 null。 */
function readInt(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value !== null && Number.isFinite(value)) {
      return Math.round(value);
    }
  }
  return null;
}

/** 先按分钟键读（×60 转秒），没有再按秒级键读；都没有返回 null 交给调用方兜底。 */
function readMinutesAsSeconds(
  record: Record<string, unknown>,
  minKeys: readonly string[],
  secKeys: readonly string[],
): number | null {
  for (const key of minKeys) {
    const value = toNumber(record[key]);
    if (value !== null) {
      return value * 60;
    }
  }
  for (const key of secKeys) {
    const value = toNumber(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  // 模型偶尔会把数字写成字符串："10分钟"、"15"
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
