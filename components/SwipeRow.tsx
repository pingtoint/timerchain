/**
 * 自定义左滑删除行的容器（规格：不要用系统默认的粗糙样式）。
 *
 * ── 为什么不用 react-native-gesture-handler 的旧版 `Swipeable` ────────
 * 旧版 Swipeable 的展开/回弹由 JS 线程驱动（Animated.event + useNativeDriver
 * 受限），快速滑动时会掉帧；新版 `ReanimatedSwipeable` 全程跑在 UI 线程上，
 * 跟手感完全不同。RNGH 3.x 里旧版已标记废弃，所以直接上 Reanimated 版本。
 *
 * ── 交互细节 ──────────────────────────────────────────────────────
 * - `overshootRight={false}`：滑到头就停住，不让删除按钮被甩出去；
 * - `friction={2}`：卡片位移略慢于手指，产生"有重量"的手感；
 * - 删除按钮用自己的弧角和图标，而不是一块裸露的红色矩形。
 */

import { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { colors, radius, spacing } from '../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';

const ACTION_WIDTH = 88;

export interface SwipeRowProps {
  children: React.ReactNode;
  /** 点删除按钮后触发。 */
  onDelete: () => void;
  deleteLabel?: string;
  /** 关闭时（例如列表进入编辑态）可临时禁用滑动。 */
  enabled?: boolean;
}

export function SwipeRow({
  children,
  onDelete,
  deleteLabel = '删除',
  enabled = true,
}: SwipeRowProps) {
  const methods = useRef<SwipeableMethods | null>(null);

  const handleDelete = useCallback(() => {
    // 先收起再回调：删除是异步的（要等 SQLite），如果不收起，
    // 卡片会在等数据库的这段时间里一直挂在"露出删除按钮"的状态。
    methods.current?.close();
    onDelete();
  }, [onDelete]);

  return (
    <View style={styles.container}>
      <ReanimatedSwipeable
        ref={methods}
        enabled={enabled}
        friction={2}
        rightThreshold={32}
        overshootRight={false}
        // 左滑不提供任何动作，避免"往哪边滑都有东西"的混乱
        renderLeftActions={undefined}
        renderRightActions={(_progress, translation) => (
          <DeleteAction translation={translation} label={deleteLabel} onPress={handleDelete} />
        )}
      >
        {children}
      </ReanimatedSwipeable>
    </View>
  );
}

interface DeleteActionProps {
  translation: SharedValue<number>;
  label: string;
  onPress: () => void;
}

/**
 * 删除按钮本体。
 * 必须跟随 `translation` 一起平移，否则在滑动手势进行到一半时会提前
 * 露在卡片右侧外面（此时卡片还没让出位置）。
 */
function DeleteAction({ translation, label, onPress }: DeleteActionProps) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translation.value + ACTION_WIDTH }],
  }));

  return (
    <Reanimated.View style={[styles.actionWrapper, animatedStyle]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
      >
        <Icon name="trash-outline" size={20} color="textOnPrimary" />
        <AppText variant="captionStrong" color="textOnPrimary">
          {label}
        </AppText>
      </Pressable>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  actionWrapper: {
    width: ACTION_WIDTH,
    // 与卡片同高：卡片高度随标题行数变化，用拉伸而不是写死高度
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  action: {
    flex: 1,
    marginLeft: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.danger,
  },
  actionPressed: {
    backgroundColor: colors.dangerPressed,
  },
});
