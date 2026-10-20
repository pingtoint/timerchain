/**
 * 页面骨架：安全区 + 背景 + 统一的内边距与内容最大宽度。
 *
 * 页面不允许自己写 `SafeAreaView` / 背景色 / 左右 padding —— 一旦允许，
 * 不同页面的左右留白就会出现 16 / 20 / 24 三种值，整机看起来是三个人做的。
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, layout } from '../theme';

export interface ScreenProps {
  children: React.ReactNode;
  /** `plain` 白底（执行页/编辑器）；`grouped` 灰底（列表页，衬托卡片）。 */
  variant?: 'plain' | 'grouped';
  /** 是否施加屏幕左右内边距。需要全宽内容（如左滑卡片）时关闭。 */
  padded?: boolean;
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/** 四边都留安全区：底部 inset 是底部固定操作条不被 Home Indicator 压住的前提。 */
const DEFAULT_EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right'];

export function Screen({
  children,
  variant = 'plain',
  padded = true,
  edges = DEFAULT_EDGES,
  style,
  contentStyle,
  testID,
}: ScreenProps) {
  return (
    <SafeAreaView
      testID={testID}
      edges={edges}
      style={[styles.root, { backgroundColor: backgroundColor(variant) }, style]}
    >
      <View style={[styles.content, padded ? styles.padded : null, contentStyle]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

function backgroundColor(variant: ScreenProps['variant']): string {
  return variant === 'grouped' ? colors.bgSecondary : colors.bg;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
  padded: {
    paddingHorizontal: layout.screenPadding,
  },
});
