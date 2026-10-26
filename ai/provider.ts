/**
 * LLM API 直连（方案 B）：OpenAI 兼容接口，一次请求拿到任务链 JSON。
 *
 * ── 与方案 A 的关系 ────────────────────────────────────────────────
 * 提示词模板（ai/planTemplate.ts）与解析器（ai/parsePlan.ts）完全复用，
 * 这里只负责「把提示词发出去、把回复文本拿回来」这一段传输。
 *
 * ── 为什么选 OpenAI 兼容协议 ───────────────────────────────────────
 * 智谱 GLM（glm-4-flash 免费）、DeepSeek、通义、火山引擎全都暴露同一套
 * /chat/completions 接口。换提供方只是换 baseUrl + key + 模型名，
 * 不需要引入任何 SDK 依赖。
 */

import { parsePlanJson, type ParsePlanResult } from './parsePlan';
import { buildPlanPrompt } from './planTemplate';

export interface AiProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  /** 引导文案：告诉用户去哪儿免费拿 key。 */
  keyHint: string;
}

/** 内置提供方。智谱 GLM-4-Flash 目前真正免费，排第一。 */
export const AI_PROVIDERS: readonly AiProviderPreset[] = [
  {
    id: 'zhipu',
    label: '智谱 GLM（免费）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    keyHint: '到 bigmodel.cn 注册，在「API keys」里免费创建',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    keyHint: '到 platform.deepseek.com 注册充值（费用极低）',
  },
] as const;

export interface AiSettings {
  providerId: string;
  apiKey: string;
}

/** 请求超时。生成一条任务链通常 5-15 秒，60 秒足够宽容。 */
const REQUEST_TIMEOUT_MS = 60_000;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/**
 * 调 LLM 生成任务链草稿。成功/失败都走 ParsePlanResult：
 * 网络、HTTP、JSON 解析三类错误统一成一句可读文案。
 */
export async function generatePlanFromText(
  settings: AiSettings,
  userInput: string,
): Promise<ParsePlanResult> {
  const preset = AI_PROVIDERS.find((p) => p.id === settings.providerId);
  if (preset === undefined) {
    return { ok: false, error: '未知的模型提供方，请到设置页重新选择。' };
  }
  if (settings.apiKey.trim().length === 0) {
    return { ok: false, error: '还没有配置 API Key，请到设置页填写。' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${preset.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: preset.model,
        messages: [{ role: 'user', content: buildPlanPrompt(userInput) }],
        // 强制 JSON 输出（智谱/DeepSeek 均支持）；解析器仍有容错，双保险
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: '请求超时，请检查网络后重试。' };
    }
    return { ok: false, error: '网络请求失败，请检查网络连接。' };
  } finally {
    clearTimeout(timer);
  }

  let body: ChatCompletionResponse;
  try {
    body = (await response.json()) as ChatCompletionResponse;
  } catch {
    return { ok: false, error: `服务返回了无法读取的内容（HTTP ${response.status}）。` };
  }

  if (!response.ok) {
    const message = body.error?.message ?? `HTTP ${response.status}`;
    if (response.status === 401) {
      return { ok: false, error: 'API Key 无效或已过期，请到设置页检查。' };
    }
    if (response.status === 429) {
      return { ok: false, error: '请求太频繁，稍等片刻再试。' };
    }
    return { ok: false, error: `生成失败：${message}` };
  }

  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return { ok: false, error: '模型返回了空内容，请重试。' };
  }

  return parsePlanJson(content);
}
