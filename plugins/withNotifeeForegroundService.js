/**
 * 注入 notifee 前台服务声明（Android 14+ 必须给 service 指定 FGS 类型）。
 *
 * 任务计时器不属于 camera/location 等预置类型，按 Android 规范走
 * `specialUse` 并声明 PROPERTY_SPECIAL_USE_FGS_SUBTYPE 说明用途。
 * notifee 的库清单里没有声明 service（只有 InitProvider），
 * 这里注入的是唯一声明，无合并冲突。
 */

const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withNotifeeForegroundService(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application?.[0];
    if (!application) return config;

    // tools:replace 需要 xmlns:tools 命名空间（CNG 生成的清单默认没有）
    if (manifest.manifest.$ && !manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    const services = application.service ?? [];
    const already = services.some(
      (s) => s.$ && s.$['android:name'] === 'app.notifee.core.ForegroundService',
    );
    if (!already) {
      services.push({
        $: {
          'android:name': 'app.notifee.core.ForegroundService',
          'android:foregroundServiceType': 'specialUse',
        },
        property: [
          {
            $: {
              'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
              'android:value': 'task_execution_timer',
            },
          },
        ],
      });
      application.service = services;
    }

    return config;
  });
};
