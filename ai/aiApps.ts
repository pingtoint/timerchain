/**
 * 探测并打开用户手机上已安装的 AI App。
 *
 * 手机上几乎都装了 DeepSeek / 豆包 / Kimi / 讯飞星火 / 通义 其中之一，
 * 每个人习惯不同，不应该硬编码某一个。做法：
 * 1. 列出主流 AI App 的深链 scheme（dpsk:// / doubao:// / kimi:// …），
 *    并通过 plugins/withAiAppQueries.js 在清单里声明 <queries> —— 否则
 *    Android 11+ 的包可见性限制会让 canOpenURL 永远返回 false
 * 2. 用 Linking.canOpenURL 探测哪些装了 —— Android 上失败时回退到
 *    canOpenURL('intent://...')，再不行就打开网页版
 * 3. 多个候选时让系统 / App 内选择一个，零候选时弹提示 + 回退网页
 */

import { Linking, Platform } from 'react-native';

export interface AiApp {
  id: string;
  label: string;
  /** App 深链 scheme；失败时回退到网页 URL。 */
  schemes: readonly string[];
  fallbackUrl: string;
}

/** 主流中文 AI App，scheme 来自各家官方文档或实测。 */
export const AI_APPS: readonly AiApp[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    // 真机实测：DeepSeek 注册的是 dpsk://（网传 deepseek:// 是错的）；
    // com.deepseek.chat:// 是它的备用 scheme
    schemes: ['dpsk://', 'com.deepseek.chat://'],
    fallbackUrl: 'https://chat.deepseek.com',
  },
  {
    id: 'doubao',
    label: '豆包',
    schemes: ['doubao://'],
    fallbackUrl: 'https://www.doubao.com/chat',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    schemes: ['kimi://', 'moonchat://'],
    fallbackUrl: 'https://kimi.moonshot.cn',
  },
  {
    id: 'xinghuo',
    label: '讯飞星火',
    schemes: ['xinghuo://'],
    fallbackUrl: 'https://xinghuo.xfyun.cn',
  },
  {
    id: 'tongyi',
    label: '通义',
    schemes: ['tongyi://'],
    fallbackUrl: 'https://tongyi.aliyun.com',
  },
  {
    id: 'glm',
    label: '智谱清言',
    schemes: ['glm://'],
    fallbackUrl: 'https://chatglm.cn',
  },
  {
    id: 'coze',
    label: '扣子',
    schemes: ['coze://'],
    fallbackUrl: 'https://www.coze.cn',
  },
];

/** 返回用户设备上实际装了的 AI App 列表。 */
export async function detectAiApps(): Promise<AiApp[]> {
  const results = await Promise.all(
    AI_APPS.map(async (app) => {
      for (const scheme of app.schemes) {
        try {
          if (await Linking.canOpenURL(`${scheme}x`)) {
            return app;
          }
        } catch {
          // scheme 不认识，跳过
        }
      }
      return null;
    }),
  );
  return results.filter((app): app is AiApp => app !== null);
}

/** 打开某个 AI App，scheme 失败则回退到网页。 */
export async function openAiApp(app: AiApp): Promise<void> {
  for (const scheme of app.schemes) {
    try {
      await Linking.openURL(`${scheme}chat`);
      return;
    } catch {
      // 此 scheme 不行，试下一个
    }
  }
  await Linking.openURL(app.fallbackUrl);
}

/** 没有 App 时打开任何一个的网页版。 */
export async function openAiWebDefault(): Promise<void> {
  await Linking.openURL(AI_APPS[0].fallbackUrl);
}
