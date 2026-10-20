/**
 * 导航栏。居中标题 + 左侧返回 + 右侧动作，与 iOS 原生导航栏保持一致的心智。
 *
 * 刻意不用 expo-router 自带的 Stack header：它的样式只能通过 screenOptions
 * 调，而本项目要求"所有 UI 来自统一组件"。自绘一个 44pt 高的栏反而更可控。
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, layout, spacing } from '../theme';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

export interface HeaderProps {
  title: string;
  subtitle?: string;
  /** 提供时左侧出现返回按钮。 */
  onBack?: () => void;
  /** 右侧动作区。 */
  right?: React.ReactNode;
  /** 底部发丝分隔线。滚动内容从栏下穿过时才需要。 */
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Header({
  title,
  subtitle,
  onBack,
  right,
  divider = false,
  style,
}: HeaderProps) {
  return (
    <View style={[styles.bar, divider ? styles.divider : null, style]}>
      <View style={styles.side}>
        {onBack === undefined ? null : (
          <IconButton
            name="chevron-back"
            accessibilityLabel="返回"
            onPress={onBack}
            variant="plain"
            size={layout.minTouchTarget}
          />
        )}
      </View>

      <View style={styles.center}>
        <AppText variant="title" align="center" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle === undefined ? null : (
          <AppText variant="caption" color="textSecondary" align="center" numberOfLines={1}>
            {subtitle}
          </AppText>
        )}
      </View>

      <View style={[styles.side, styles.sideRight]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.minTouchTarget,
    paddingVertical: spacing.xs,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  side: {
    minWidth: layout.minTouchTarget,
    justifyContent: 'center',
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
  },
});
