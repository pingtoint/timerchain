/**
 * AI 生成任务链的提示词模板。
 *
 * 这是 App 的"任务配置说明书"：字段含义、取值范围、输出格式、示例都集中
 * 在这一个文件里。AI（DeepSeek 网页版 / API，或任何其它大模型）只要严格
 * 按模板输出，App 端的解析器（ai/parsePlan.ts）就能把它变成任务链。
 *
 * ── 为什么用"分钟"而不是秒 ─────────────────────────────────────────
 * 模型对"10 分钟"的理解远比"600 秒"稳定；秒级换算由解析器统一完成，
 * 提示词里不出现秒，避免 AI 自己算错。
 *
 * 修改模板时注意：`{{USER_INPUT}}` 占位符必须保留，用户文字会被替换到这里。
 */

/** 用户输入在模板中的插入位置。 */
const USER_INPUT_PLACEHOLDER = '{{USER_INPUT}}';

/**
 * 模板正文。同时也是方案 B（API 直连）的 system/user 提示词来源，
 * 改这里两处同时生效。
 */
export const PLAN_PROMPT_TEMPLATE = `# 任务链拆解助手

你是一个任务链拆解助手。我会给你一段文字描述，请把它拆解成一条「计时任务链」。

## 任务链是什么

一条任务链 = 一个名称 + 若干按顺序执行的步骤。每个步骤有独立倒计时，一步完成后自动（或经短暂休息后）进入下一步。典型场景：晨间例行、健身流程、番茄工作法、烹饪流程。

## 输出格式（严格遵守）

只输出一个 JSON 对象，不要输出任何解释、前言或 markdown 代码围栏。结构如下：

{
  "title": "任务链名称，不超过 20 字",
  "steps": [
    {
      "title": "步骤标题，必填，简短",
      "content": "步骤要点说明，没有就填空字符串",
      "mode": "timed",
      "durationMin": 10,
      "restMin": 1,
      "repeatCount": 1,
      "repeatGapSec": 0,
      "alertSound": "chime"
    }
  ]
}

字段规则：
- steps：数组，按执行顺序排列，至少 1 步
- mode：步骤计量方式，二选一，只能填 "timed"（计时，倒计时自动推进）或 "count"（计次，用户手动点完成）
- durationMin：仅 timed 步骤有效，该步骤的计时时长，单位分钟，数字，必须大于 0，可以是小数（如 0.5 表示 30 秒）；count 步骤固定填 0
- repeatCount：仅 count 步骤有效，要做的遍数，整数，≥1；timed 步骤固定填 1
- repeatGapSec：仅 count 步骤且 repeatCount > 1 时有效，每两遍之间的间隙，单位秒，整数，≥0；其它情况固定填 0
- restMin：该步骤完成后的休息时长，单位分钟，数字，没有休息填 0；最后一步固定填 0
- alertSound：步骤完成时的提醒音，只能填 "chime"（清脆）/ "beep"（短促）/ "none"（静音），拿不准就填 "chime"
- 描述里"做 N 个 / N 次 / N 组 / N 遍"且没给时长的，用 count 模式，repeatCount 填 N
- 描述中没提休息时间的，步骤之间默认给 1 分钟休息
- 描述中没提时长的 timed 步骤，根据常识估算一个合理值

## 输出示例

我的描述：早上 7 点起床，先洗漱 10 分钟，冥想一刻钟，然后晨跑半小时，跑完休息 5 分钟再拉伸 10 分钟。

你的输出：
{"title":"晨间例行","steps":[{"title":"洗漱","content":"","mode":"timed","durationMin":10,"restMin":1,"repeatCount":1,"repeatGapSec":0,"alertSound":"chime"},{"title":"冥想","content":"安静坐下，专注呼吸","mode":"timed","durationMin":15,"restMin":1,"repeatCount":1,"repeatGapSec":0,"alertSound":"chime"},{"title":"晨跑","content":"","mode":"timed","durationMin":30,"restMin":5,"repeatCount":1,"repeatGapSec":0,"alertSound":"chime"},{"title":"拉伸","content":"跑后拉伸放松","mode":"timed","durationMin":10,"restMin":0,"repeatCount":1,"repeatGapSec":0,"alertSound":"chime"}]}

我的描述：俯卧撑 15 个一组做 3 组，组间歇 30 秒，然后平板支撑 1 分钟。

你的输出：
{"title":"力量训练","steps":[{"title":"俯卧撑","content":"15 个一组","mode":"count","durationMin":0,"restMin":0.5,"repeatCount":3,"repeatGapSec":30,"alertSound":"beep"},{"title":"平板支撑","content":"保持核心收紧","mode":"timed","durationMin":1,"restMin":0,"repeatCount":1,"repeatGapSec":0,"alertSound":"chime"}]}

## 我的描述

${USER_INPUT_PLACEHOLDER}`;

/**
 * 用模板 + 用户输入拼出完整提示词。
 * 占位符意外丢失时退化为拼接，保证用户文字一定出现在提示词里。
 */
export function buildPlanPrompt(userInput: string): string {
  const input = userInput.trim();
  if (PLAN_PROMPT_TEMPLATE.includes(USER_INPUT_PLACEHOLDER)) {
    return PLAN_PROMPT_TEMPLATE.replace(USER_INPUT_PLACEHOLDER, input);
  }
  return `${PLAN_PROMPT_TEMPLATE}\n\n${input}`;
}
