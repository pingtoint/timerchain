/**
 * 可滑动卡片容器。
 *
 * ── 手势互斥（核心修复） ────────────────────────────────────────────
 * 主流 App（Gmail、iOS 设置、微信消息）的左滑行互斥：滑开第二条时，第一条自动收起。
 * 之前每个 SwipeRow 独立持有 ref，互不感知，导致连续滑多条时前一条挂在露出态。
 *
 * 修复：父级通过 `onSwipeableOpen` 回调把 methods 传出来，Swipable 之间通过
 * `openOther` 互斥。右滑不再给空占位（`renderLeftActions` 会吞掉 overshoot
 * 手势让回弹失效），改用 `activeOffsetX` 只激活左滑，右滑自然回弹。
 *
 * ── 按钮排列（左滑露出） ────────────────────────────────────────────
 * 从左到右：编辑 → 删除 → 导出。导出贴卡片右缘，滑得浅先露出。
 * 滑到 1/3 宽度自动吸住全露，松手自然弹回。
 */

import { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import ReanimatedSwipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { colors, radius, spacing } from '../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';

const ACTION_WIDTH = 80;

export interface SwipeRowProps {
  children: React.ReactNode;
  /** 左滑 = 编辑（最左，滑得深时露出）。可选。 */
  onEdit?: () => void;
  editLabel?: string;
  /** 左滑 = 导出（贴卡片右缘，滑得浅时先露出）。可选。 */
  onShare?: () => void;
  shareLabel?: string;
  /** 左滑 = 删除（居中）。必选。 */
  onDelete: () => void;
  deleteLabel?: string;
  /** 禁用滑动（多选模式等）。 */
  enabled?: boolean;
  /** 父级提供的互斥 close 函数，其他行打开时调它先收起自己。 */
  openOther?: () => void;
  /** 自己被滑开时调父级，让父级通知其他行。 */
  onOpened?: (methods: SwipeableMethods) => void;
  /** 自己收起时调父级。 */
  onClosed?: () => void;
}

export function SwipeRow({
  children,
  onEdit,
  editLabel = '编辑',
  onShare,
  shareLabel = '导出',
  onDelete,
  deleteLabel = '删除',
  enabled = true,
  openOther,
  onOpened,
  onClosed,
}: SwipeRowProps) {
  const methods = useRef<SwipeableMethods | null>(null);

  const close = useCallback(() => methods.current?.close(), []);

  const handleEdit = useCallback(() => {
    close();
    onEdit?.();
  }, [close, onEdit]);

  const handleShare = useCallback(() => {
    close();
    onShare?.();
  }, [close, onShare]);

  const handleDelete = useCallback(() => {
    close();
    onDelete();
  }, [close, onDelete]);

  const actionCount = (onEdit ? 1 : 0) + (onShare ? 1 : 0) + 1;

  return (
    <View style={styles.container}>
      <ReanimatedSwipeable
        ref={methods}
        enabled={enabled}
        friction={2}
        // 左滑吸住阈值：超过按钮总宽的一半就吸住全露
        rightThreshold={(ACTION_WIDTH * actionCount) / 2}
        // 右滑橡皮筋感：给一个有实际宽度但透明的占位让手势跟手移动，
        // 再用 MAX_SAFE_INTEGER 阈值保证松手永远弹回原位
        renderLeftActions={() => <View style={{ width: 60 }} />}
        leftThreshold={Number.MAX_SAFE_INTEGER}
        overshootFriction={8}
        // 第二条刚开始被拖就立刻关第一条（比 onSwipeableOpen 早 200ms+）
        onSwipeableOpenStartDrag={(dir) => {
          if (dir === SwipeDirection.LEFT) openOther?.();
        }}
        onSwipeableOpen={(dir) => {
          if (dir === SwipeDirection.LEFT) {
            onOpened?.(methods.current!);
          }
        }}
        onSwipeableClose={(dir) => {
          if (dir === SwipeDirection.LEFT) {
            onClosed?.();
          }
        }}
        renderRightActions={(_progress, translation) => (
          <TrailingActions
            translation={translation}
            width={ACTION_WIDTH * actionCount}
            onEdit={onEdit === undefined ? null : { label: editLabel, onPress: handleEdit }}
            onShare={onShare === undefined ? null : { label: shareLabel, onPress: handleShare }}
            onDelete={{ label: deleteLabel, onPress: handleDelete }}
          />
        )}
      >
        {children}
      </ReanimatedSwipeable>
    </View>
  );
}

interface TrailingButton {
  label: string;
  onPress: () => void;
}

interface TrailingActionsProps {
  translation: SharedValue<number>;
  width: number;
  onEdit: TrailingButton | null;
  onShare: TrailingButton | null;
  onDelete: TrailingButton;
}

/**
 * 右侧动作组（左滑手势露出）。
 * translation 是负数（卡片被拖向左），按钮组跟随 translateX 贴到卡片右边缘。
 *
 * 从左到右排列：编辑 → 删除 → 导出。
 * 滑得浅先露出编辑（贴卡片右缘），滑到中间露出删除，全滑露出导出。
 */
function TrailingActions({ translation, width, onEdit, onShare, onDelete }: TrailingActionsProps) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translation.value + width }],
  }));

  return (
    <Reanimated.View style={[styles.actionsRow, { width }, animatedStyle]}>
      {onEdit === null ? null : (
        <ActionButton
          {...onEdit}
          icon="create-outline"
          background={colors.primary}
          backgroundPressed={colors.primaryPressed}
        />
      )}
      <ActionButton
        {...onDelete}
        icon="trash-outline"
        background={colors.danger}
        backgroundPressed={colors.dangerPressed}
      />
      {onShare === null ? null : (
        <ActionButton
          {...onShare}
          icon="share-social-outline"
          background={colors.primarySoft}
          backgroundPressed={colors.primary}
          tint="primary"
        />
      )}
    </Reanimated.View>
  );
}

interface ActionButtonProps {
  label: string;
  icon: 'trash-outline' | 'share-social-outline' | 'create-outline';
  background: string;
  backgroundPressed: string;
  tint?: 'primary' | 'textOnPrimary';
  onPress: () => void;
}

function ActionButton({ label, icon, background, backgroundPressed, tint, onPress }: ActionButtonProps) {
  const iconColor = tint === 'primary' ? 'primary' : 'textOnPrimary';
  const textColor = tint === 'primary' ? 'primary' : 'textOnPrimary';
  return (
    <View style={styles.actionWrapper}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.action,
          { backgroundColor: pressed ? backgroundPressed : background },
        ]}
      >
        <Icon name={icon} size={20} color={iconColor} />
        <AppText variant="captionStrong" color={textColor}>
          {label}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'flex-end',
  },
  actionWrapper: {
    width: ACTION_WIDTH,
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
  },
});
