/**
 * 重命名弹窗：导入时检测到与现有任务重名，拦截保存并要求改名。
 *
 * 不复用 Dialog 的原因同 AI App 选择器：Dialog 不支持 children，
 * 这里有输入框（而且确认按钮要随输入内容动态置灰）。
 *
 * 交互惯例（文件管理器 / 网盘「另存为」）：
 * - 输入框预填自动建议名 "XX (2)"；
 * - 名字为空或仍与现有任务重名时，确认按钮置灰；
 * - 点遮罩 / 取消回到预览页，不做任何修改。
 */

import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, shadow, spacing } from '../theme';
import { isDuplicateTitle } from '../utils/duplicateName';
import { AppText } from './AppText';
import { Button } from './Button';
import { TextField } from './TextField';

export interface RenameDialogProps {
  visible: boolean;
  originalTitle: string;
  /** 自动改名建议（页面用 suggestUniqueTitle 预先算好）。 */
  initialTitle: string;
  /** 全部现有任务名（用于确认时二次校验）。 */
  existingTitles: readonly string[];
  onConfirm: (newTitle: string) => void;
  onCancel: () => void;
}

export function RenameDialog({
  visible,
  originalTitle,
  initialTitle,
  existingTitles,
  onConfirm,
  onCancel,
}: RenameDialogProps) {
  const [value, setValue] = useState(initialTitle);
  // 本组件由页面在 visible=true 时才挂载，所以 useState 初值就是本次的建议名，
  // 无需 useEffect 同步（也避开 setState-in-effect 反模式）。

  const trimmed = value.trim();
  const stillDuplicate = isDuplicateTitle(trimmed, existingTitles);
  const confirmDisabled = trimmed.length === 0 || stillDuplicate;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityRole="button" accessibilityLabel="关闭重命名弹窗">
        <Pressable style={[styles.card, shadow.raised]} onPress={() => undefined}>
          <AppText variant="h2" align="center">
            任务名重复
          </AppText>
          <AppText variant="body" color="textSecondary" align="center" style={styles.message}>
            已有同名任务「{originalTitle}」，改个名字再保存。
          </AppText>

          <TextField
            value={value}
            onChangeText={setValue}
            autoFocus
            maxLength={50}
            error={stillDuplicate ? '这个名字也被占用了，请再换一个' : undefined}
            onSubmitEditing={() => {
              if (!confirmDisabled) {
                onConfirm(trimmed);
              }
            }}
          />

          <View style={styles.actions}>
            <Button label="取消" onPress={onCancel} variant="secondary" fullWidth />
            <Button
              label="改名并保存"
              icon="checkmark"
              fullWidth
              disabled={confirmDisabled}
              onPress={() => onConfirm(trimmed)}
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
    marginBottom: spacing.md,
  },
  actions: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
});
