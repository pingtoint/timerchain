/**
 * 提醒音选择器：分段控件 + 试听。
 *
 * 试听行为刻意绑在"切换选项"这一个动作上：点哪个就响哪个，
 * 用户不需要再找一个单独的"试听"按钮。这也是为什么试听回调由上层注入 ——
 * 组件不直接引音频模块，保持了 DS 组件的纯粹性（在测试/Storybook 里
 * 渲染它不会意外播放声音）。
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ALERT_SOUNDS, ALERT_SOUND_LABEL, type AlertSound } from '../types';
import { spacing } from '../theme';
import { AppText } from './AppText';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';
import type { IconName } from './Icon';

export interface SoundPickerProps {
  label?: string;
  value: AlertSound;
  onChange: (next: AlertSound) => void;
  /** 切换时触发，用于试听。 */
  onPreview?: (next: AlertSound) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const SOUND_ICON: Record<AlertSound, IconName> = {
  chime: 'musical-notes-outline',
  beep: 'alert-circle-outline',
  none: 'volume-mute-outline',
};

const OPTIONS: readonly SegmentedOption<AlertSound>[] = ALERT_SOUNDS.map((sound) => ({
  value: sound,
  label: ALERT_SOUND_LABEL[sound],
  icon: SOUND_ICON[sound],
}));

export function SoundPicker({
  label = '提醒音',
  value,
  onChange,
  onPreview,
  disabled = false,
  style,
}: SoundPickerProps) {
  return (
    <View style={[styles.container, style]}>
      <AppText variant="captionStrong" color="textSecondary" style={styles.label}>
        {label}
      </AppText>

      <SegmentedControl
        options={OPTIONS}
        value={value}
        disabled={disabled}
        onChange={(next) => {
          onPreview?.(next);
          onChange(next);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  label: {
    marginBottom: spacing.sm,
  },
});
