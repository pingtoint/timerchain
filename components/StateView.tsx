/**
 * 加载态与错误态（规格要求：两者必须单独设计）。
 *
 * 一个组件两种形态，是因为它们共享同一套"居中、留白、层级"的骨架；
 * 差异只在图标、文案与是否有重试动作。真正要避免的是"复用空状态文案"
 * 这类敷衍 —— 所以文案由调用方逐字传入，而不是内部写死一句"出错了"。
 */

import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

export interface StateViewProps {
  variant: 'loading' | 'error';
  title?: string;
  description?: string;
  /** 错误态的重试动作。 */
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_TITLE: Record<StateViewProps['variant'], string> = {
  loading: '正在读取本地数据',
  error: '加载失败',
};

const FALLBACK_ICON: IconName = 'cloud-offline-outline';

export function StateView({
  variant,
  title,
  description,
  onRetry,
  retryLabel = '重试',
  style,
}: StateViewProps) {
  const heading = title ?? DEFAULT_TITLE[variant];

  return (
    <View style={[styles.container, style]}>
      {variant === 'loading' ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : (
        <View style={styles.iconBubble}>
          <Icon name={FALLBACK_ICON} size={28} color="danger" />
        </View>
      )}

      <AppText variant="bodyStrong" align="center" style={styles.title}>
        {heading}
      </AppText>

      {description === undefined ? null : (
        <AppText variant="caption" color="textSecondary" align="center" style={styles.description}>
          {description}
        </AppText>
      )}

      {variant === 'error' && onRetry !== undefined ? (
        <Button
          label={retryLabel}
          onPress={onRetry}
          variant="secondary"
          icon="refresh"
          style={styles.retry}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  iconBubble: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerSoft,
  },
  title: {
    marginTop: spacing.md,
  },
  description: {
    marginTop: spacing.xs,
  },
  retry: {
    marginTop: spacing.lg,
  },
});
