/**
 * Android 11+（API 30）"软件包可见性"限制：清单里没有 <queries> 声明的应用，
 * Linking.canOpenURL 一律返回 false —— 装了 DeepSeek 也探测不到。
 *
 * Expo SDK 58 的 app.json schema 不支持 queries 字段，所以用本地 config plugin
 * 把 AI App 的深链 scheme / 包名注入 AndroidManifest 的 <queries>。
 *
 * scheme 来源：真机 `dumpsys package` 实测（DeepSeek 注册的是 dpsk:// 和
 * com.deepseek.chat://，网上流传的 deepseek:// 是错的）。
 */

const { withAndroidManifest } = require('expo/config-plugins');

/** 需要探测可见性的深链 scheme（对应 ai/aiApps.ts 的 AI_APPS）。 */
const AI_SCHEMES = [
  'dpsk',
  'com.deepseek.chat',
  'doubao',
  'kimi',
  'moonchat',
  'xinghuo',
  'tongyi',
  'glm',
  'coze',
];

/** 已确认的 AI App 包名（scheme 探测已够用，包名是给未来直接启动预留的）。 */
const AI_PACKAGES = [
  'com.deepseek.chat', // DeepSeek
  'com.larus.nova', // 豆包
  'com.moonshot.kimichat', // Kimi
];

module.exports = function withAiAppQueries(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const existing = manifest.queries ?? [];

    // 已声明的 scheme / 包名收集起来去重，避免重复 prebuild 时越加越多
    const schemes = new Set();
    const packages = new Set();
    for (const query of existing) {
      for (const intent of query.intent ?? []) {
        for (const data of intent.data ?? []) {
          const scheme = data.$?.['android:scheme'];
          if (scheme) schemes.add(scheme);
        }
      }
      for (const pkg of query.package ?? []) {
        const name = pkg.$?.['android:name'];
        if (name) packages.add(name);
      }
    }

    for (const scheme of AI_SCHEMES) schemes.add(scheme);
    for (const name of AI_PACKAGES) packages.add(name);

    manifest.queries = [
      {
        package: [...packages].map((name) => ({ $: { 'android:name': name } })),
        intent: [...schemes].map((scheme) => ({
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          data: [{ $: { 'android:scheme': scheme } }],
        })),
      },
    ];

    return config;
  });
};
