/**
 * 分段控件：在互斥的少量选项之间切换（提醒音、货币类的小选择）。
 *
 * 为什么不直接用一组 Button：分段控件的语义是"这些选项共享一个取值"，
 * 视觉上必须是一个整体（共享一个轨道），而不是若干个各自独立的按钮。
 */

import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, layout, radius, shadow, spacing } from '../theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  style,
}: SegmentedControlProps<T>) {
  return (
    <View style={[styles.track, style]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={option.label}
            style={[styles.segment, selected ? styles.segmentSelected : null]}
          >
            <View style={styles.segmentContent}>
              {option.icon === undefined ? null : (
                <Icon
                  name={option.icon}
                  size={16}
                  color={disabled ? 'textDisabled' : selected ? 'primary' : 'textSecondary'}
                />
              )}
              <AppText
                variant="captionStrong"
                color={disabled ? 'textDisabled' : selected ? 'primary' : 'textSecondary'}
              >
                {option.label}
              </AppText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  segment: {
    flex: 1,
    height: layout.minTouchTarget - spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  /** 选中项是"白色滑块浮在灰轨道上"，这是 iOS 分段控件的原生语义。 */
  segmentSelected: {
    backgroundColor: colors.bg,
    ...shadow.card,
  },
  segmentContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
