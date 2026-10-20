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

import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppText, Card, Divider, Header, Screen } from '../components';
import { describeTimerSupport } from '../hooks/useTimer';
import { spacing } from '../theme';

export default function SettingsScreen() {
  const router = useRouter();
  // 每次进入都重新读一次能力，而不是缓存在模块里 —— 用户可能在两次进入之间
  // 换了运行环境（例如从 Expo Go 换成了 development build）。
  const support = describeTimerSupport();

  return (
    <Screen variant="grouped">
      <Header title="设置" onBack={() => router.back()} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Card padding="md">
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
          <AppText variant="bodyStrong">关于计时精度</AppText>
          <Divider spacingY="sm" />
          <AppText variant="caption" color="textSecondary">
            倒计时依据"本阶段的结束时间戳"计算，不是每秒累减。因此锁屏、切后台、
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

const styles = StyleSheet.create({
  content: {
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  card: {
    marginTop: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
