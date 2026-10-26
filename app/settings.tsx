/**
 * 设置页（规格：阶段二可先不做，但预留路由）。
 *
 * 这里只放一件**当前版本真有意义**的事：如实告诉用户"切到后台后计时器到底
 * 靠不靠谱"。这是本 App 唯一一个用户无法从界面上自行判断、却直接影响
 * 使用信心的信息 —— 与其让他试错，不如直接写清楚。
 *
 * 其它设置项（主题、默认时长、数据导出）留到阶段二，避免现在堆一排
 * 点了没反应的开关。
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AI_PROVIDERS } from '../ai/provider';
import { clearAiSettings, loadAiSettings, saveAiSettings } from '../ai/settings';
import { AppText, Button, Card, Divider, Header, Screen, SegmentedControl, TextField } from '../components';
import { describeTimerSupport } from '../hooks/useTimer';
import { showBackgroundGuideAgain } from '../notifications/backgroundGuide';
import { spacing } from '../theme';

export default function SettingsScreen() {
  const router = useRouter();
  // 每次进入都重新读一次能力，而不是缓存在模块里 —— 用户可能在两次进入之间
  // 换了运行环境（例如从 Expo Go 换成了 development build）。
  const support = describeTimerSupport();

  // ── AI 直连设置（方案 B）。key 存 expo-secure-store，不落明文。 ──
  const [providerId, setProviderId] = useState<string>(AI_PROVIDERS[0].id);
  const [apiKey, setApiKey] = useState('');
  /** 已保存的 key 掩码，用于提示"当前已配置"，不回显明文。 */
  const [savedMask, setSavedMask] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void loadAiSettings().then((settings) => {
        if (settings === null) {
          setSavedMask(null);
          return;
        }
        setProviderId(settings.providerId);
        setSavedMask(maskKey(settings.apiKey));
      });
    }, []),
  );

  const preset = AI_PROVIDERS.find((p) => p.id === providerId) ?? AI_PROVIDERS[0];

  const save = useCallback(() => {
    const key = apiKey.trim();
    if (key.length === 0) {
      return;
    }
    void saveAiSettings({ providerId, apiKey: key }).then(() => {
      setApiKey('');
      setSavedMask(maskKey(key));
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    });
  }, [apiKey, providerId]);

  const clear = useCallback(() => {
    void clearAiSettings().then(() => {
      setApiKey('');
      setSavedMask(null);
    });
  }, []);

  return (
    <Screen variant="grouped">
      <Header title="设置" onBack={() => router.back()} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Card padding="md">
          <AppText variant="bodyStrong">AI 直连生成（可选）</AppText>
          <Divider spacingY="sm" />
          <AppText variant="caption" color="textSecondary" style={styles.blockHint}>
            配置 API Key 后，「AI 生成任务」可以一键直接生成，不用再手动复制粘贴。
            没有 Key 也不影响，剪贴板方式永远可用。
          </AppText>

          <SegmentedControl
            options={AI_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
            value={preset.id}
            onChange={setProviderId}
            style={styles.blockHint}
          />

          <TextField
            value={apiKey}
            onChangeText={setApiKey}
            placeholder={savedMask === null ? '粘贴 API Key' : `当前已配置：${savedMask}，粘贴新 Key 可替换`}
            hint={preset.keyHint}
            maxLength={200}
          />

          <View style={styles.keyButtons}>
            <Button
              label={savedTick ? '已保存 ✓' : '保存 Key'}
              icon="key-outline"
              variant="secondary"
              size="sm"
              disabled={apiKey.trim().length === 0}
              onPress={save}
            />
            {savedMask === null ? null : (
              <Button label="清除" variant="ghost" size="sm" onPress={clear} />
            )}
          </View>
        </Card>

        <Card padding="md" style={styles.card}>
          <View style={styles.row}>
            <AppText variant="bodyStrong">后台计时</AppText>
            <AppText
              variant="caption"
              color={support.nativeModuleAvailable ? 'success' : 'warning'}
            >
              {support.nativeModuleAvailable ? '已启用' : '未启用'}
            </AppText>
          </View>

          <Divider spacingY="sm" />

          <AppText variant="caption" color="textSecondary">
            {support.summary}
          </AppText>
        </Card>

        <Card padding="md" style={styles.card}>
          <View style={styles.row}>
            <AppText variant="bodyStrong">后台运行保障</AppText>
            <Button
              label="去配置"
              icon="shield-checkmark-outline"
              variant="secondary"
              size="sm"
              onPress={() => void showBackgroundGuideAgain()}
            />
          </View>

          <Divider spacingY="sm" />

          <AppText variant="caption" color="textSecondary">
            提醒要在 App 关闭后准时响，需要把 TimerChain 加入电池优化白名单，
            并在国产机型（华为/荣耀等）的「应用启动管理」中允许自启动和后台活动。
            点「去配置」查看一步步引导。
          </AppText>
        </Card>

        <Card padding="md" style={styles.card}>
          <AppText variant="bodyStrong">关于计时精度</AppText>
          <Divider spacingY="sm" />
          <AppText variant="caption" color="textSecondary">
            倒计时依据「本阶段的结束时间戳」计算，不是每秒累减。因此锁屏、切后台、
            丢帧都不会让计时变慢；回到前台时会一次性补齐跳过的阶段。
          </AppText>
        </Card>

        <Card padding="md" style={styles.card}>
          <AppText variant="bodyStrong">提醒音</AppText>
          <Divider spacingY="sm" />
          <AppText variant="caption" color="textSecondary">
            默认遵循系统静音开关：手机拨到静音时不会强制出声，但每一步切换仍会有
            震动反馈。音频文件位于 assets/sounds/，可自行替换。
          </AppText>
        </Card>
      </ScrollView>
    </Screen>
  );
}

/** Key 掩码：只露前 4 位，避免回显明文被偷看。 */
function maskKey(key: string): string {
  return `${key.slice(0, 4)}…（共 ${key.length} 位）`;
}

const styles = StyleSheet.create({
  content: {
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  card: {
    marginTop: 0,
  },
  blockHint: {
    marginBottom: spacing.sm,
  },
  keyButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
