/**
 * 任务链导入导出文件格式。
 *
 * ── 文件的三重身份 ─────────────────────────────────────────────────
 * 1. 分享：导出成 .json 文件发给别的用户，对方在 App 里导入；
 * 2. 提示词：文件自带 `_readme` 结构说明，把它和改造需求一起发给
 *    大模型，AI 就知道必须按相同结构输出；
 * 3. 解析目标：AI 改造后的输出、以及用户手贴的 JSON，都由
 *    ai/parsePlan.ts 统一解析（它已经容忍 { plan: {...} } 包装）。
 *
 * 字段用分钟（与 ai/planTemplate.ts 一致），秒级换算只发生在解析层。
 */

import type { Plan } from '../types';

export const PLAN_FILE_FORMAT = 'timerchain-plan';
export const PLAN_FILE_VERSION = 1;

/** 写给大模型看的结构说明。会原样出现在每个导出文件里。 */
const PLAN_FILE_README = [
  '这是 TimerChain 任务链文件，可直接在 TimerChain App 中导入。',
  '【给 AI 的说明】如果用户要求你改造这份任务链，请保持本文件的顶层结构与字段名完全不变（format / version / plan），只修改 plan 内的 title 和 steps 数组，并只输出修改后的完整 JSON 对象 —— 不要 markdown 围栏，不要任何解释文字。',
  'plan.steps 数组按执行顺序排列，每项字段：',
  '- title：步骤标题，必填，简短；',
  '- content：步骤要点说明，没有就填空字符串；',
  '- mode：计量方式，"timed"（倒计时自动推进）或 "count"（做 N 遍，手动点完成）；',
  '- durationMin：仅 timed 有效，计时时长（分钟，>0，可小数）；count 步骤固定为 0；',
  '- repeatCount：仅 count 有效，遍数（整数，≥1）；timed 步骤固定为 1；',
  '- repeatGapSec：仅 count 且 repeatCount>1 有效，两遍之间的间隙秒数（≥0），否则为 0；',
  '- restMin：步骤完成后的休息时长，单位分钟，数字，没有休息填 0，最后一步固定为 0；',
  '- alertSound：提醒音，只能填 "chime"（清脆）/ "beep"（短促）/ "none"（静音）。',
].join('\n');

interface PlanFileStep {
  title: string;
  content: string;
  mode: 'timed' | 'count';
  durationMin: number;
  restMin: number;
  repeatCount: number;
  repeatGapSec: number;
  alertSound: string;
}

interface PlanFile {
  format: typeof PLAN_FILE_FORMAT;
  version: typeof PLAN_FILE_VERSION;
  _readme: string;
  plan: {
    title: string;
    steps: PlanFileStep[];
  };
}

/** 秒 → 分钟。能整除时给整数，文件更干净（300 → 5，90 → 1.5）。 */
function secToMin(sec: number): number {
  const min = sec / 60;
  return Number.isInteger(min) ? min : Math.round(min * 100) / 100;
}

/** 把一条任务链序列化成可分享的 JSON 文件内容。 */
export function buildPlanFileContent(plan: Plan): string {
  const lastIndex = plan.steps.length - 1;
  const file: PlanFile = {
    format: PLAN_FILE_FORMAT,
    version: PLAN_FILE_VERSION,
    _readme: PLAN_FILE_README,
    plan: {
      title: plan.title,
      steps: plan.steps.map((step, index) => ({
        title: step.title,
        content: step.content,
        mode: step.kind,
        durationMin: step.kind === 'count' ? 0 : secToMin(step.durationSec),
        // 最后一步的停歇在落库时已被强制为 0，这里仍显式写出，保证语义完整
        restMin: index === lastIndex ? 0 : secToMin(step.restAfterSec),
        repeatCount: step.kind === 'count' ? step.repeatCount : 1,
        repeatGapSec: step.kind === 'count' && step.repeatCount > 1 ? step.repeatRestSec : 0,
        alertSound: step.alertSound,
      })),
    },
  };
  return JSON.stringify(file, null, 2);
}

/** 导出文件名：安全字符 + 时间戳，避免覆盖。 */
export function planFileName(plan: Plan): string {
  const safe = plan.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30) || 'plan';
  const stamp = new Date().toISOString().slice(0, 10);
  return `timerchain_${safe}_${stamp}.json`;
}
