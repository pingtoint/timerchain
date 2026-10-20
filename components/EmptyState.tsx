/**
 * 空状态。
 *
 * 规格要求"空状态必须单独设计，不能敷衍"，所以它不是一句灰字，而是一个
 * 完整的引导：图标 + 标题 + 描述 + 一个明确的下一步动作。
 *
 * 图标不是插画：这里用色调极淡的圆形底 + 线性图标，保持"内容为主、
 * 装饰为辅"的层级，避免首页变成一张海报。
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  description: string;
  /** 可选的动作区（通常放主按钮）。 */
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({ icon, title, description, action, style }: EmptyStateProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconBubble}>
        <Icon name={icon} size={32} color="primary" />
      </View>

      <AppText variant="h2" align="center">
        {title}
      </AppText>

      <AppText variant="body" color="textSecondary" align="center" style={styles.description}>
        {description}
      </AppText>

      {action === undefined ? null : <View style={styles.action}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  iconBubble: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    marginBottom: spacing.lg,
  },
  description: {
    marginTop: spacing.sm,
  },
  action: {
    marginTop: spacing.lg,
    alignSelf: 'stretch',
  },
});
