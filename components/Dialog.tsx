/**
 * 确认弹窗。
 *
 * 不用系统 `Alert.alert` 的原因：
 * 1. 它在 Android 与 iOS 上是两套完全不同的外观，无法统一"精致感"；
 * 2. 危险操作（终止任务、删除任务）需要一个明确的危险色按钮，
 *    系统弹窗的按钮色只能被动跟随主题。
 * 3. 系统弹窗无法承载"取消/确认"以外的任何内容（例如"该任务正在执行"这类说明）。
 */

import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, shadow, spacing } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';

export interface DialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  /**
   * 次要动作的文案。传 `null` 表示这是一个"单向通知"弹窗
   * （例如"某步标题不能为空"），只留一个确认按钮。
   * 默认值为"取消"。
   */
  cancelLabel?: string | null;
  /** `danger` 用于终止/删除这类不可逆操作。 */
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export function Dialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  onConfirm,
  onCancel,
}: DialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      {/* 点遮罩取消：这是用户对模态框的默认预期 */}
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityRole="button" accessibilityLabel="关闭弹窗">
        {/* 拦截卡片内部点击，避免点内容也触发"取消" */}
        <Pressable style={[styles.card, shadow.raised]} onPress={() => undefined}>
          <AppText variant="h2" align="center">
            {title}
          </AppText>

          {message === undefined ? null : (
            <AppText variant="body" color="textSecondary" align="center" style={styles.message}>
              {message}
            </AppText>
          )}

          <View style={styles.actions}>
            {cancelLabel === null ? null : (
              <Button
                label={cancelLabel ?? '取消'}
                onPress={onCancel}
                variant="secondary"
                fullWidth
              />
            )}
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              variant={tone === 'danger' ? 'danger' : 'primary'}
              fullWidth
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
  },
  message: {
    marginTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
});
