/**
 * 根布局。
 *
 * 它承担了四件"必须全局只有一份"的事：
 * 1. `GestureHandlerRootView` —— 所有手势（拖拽排序、左滑删除）的前提；
 * 2. 音频会话配置 —— 提醒音能否在静音/后台下工作取决于它，只能配一次；
 * 3. `useRunAlerts()` —— 提醒总线。挂在根布局而不是执行页，
 *    这样切到后台再回前台、或用户此刻不在执行页时，提醒依然会响；
 * 4. 冷启动重置运行时状态（规格 E：App 被杀后重新打开，状态回到 idle）。
 */

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '../components';
import { configureAudioSession, useRunAlerts } from '../hooks/useAlert';
import { usePlanStore } from '../store/planStore';
import { layout, spacing } from '../theme';

export default function RootLayout() {
  useEffect(() => {
    void configureAudioSession();
    // 冷启动即归零：上次被杀时残留的 run 状态没有任何意义（也不做恢复，
    // 因为"恢复到哪一步"需要落库 + 处理被跳过的阶段，复杂度远大于收益）。
    usePlanStore.getState().clearRun();
  }, []);

  useRunAlerts();

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: styles.stackContent,
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="edit" />
          {/*
            执行页关闭侧滑返回：iOS 的边缘手势会在用户只是想横向操作时
            把页面退掉，而执行中的中断必须经过确认弹窗（规格 E）。
          */}
          <Stack.Screen name="run" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="settings" />
        </Stack>

        <GlobalBanner />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * 阶段横幅的宿主。绝对定位在页面之上，`pointerEvents="none"` 保证
 * 它不会吞掉下方内容的点击 —— 一个只展示 3 秒的浮层不该拦截任何交互。
 */
function GlobalBanner() {
  const alert = usePlanStore((state) => state.alert);
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="none"
      style={[styles.bannerLayer, { top: insets.top + spacing.sm }]}
    >
      <Banner alert={alert} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  stackContent: {
    flex: 1,
  },
  bannerLayer: {
    position: 'absolute',
    left: layout.screenPadding,
    right: layout.screenPadding,
    // 高于 Stack 内容；Android 需要 elevation 才会真正叠在上层
    zIndex: 10,
    elevation: 10,
  },
});
