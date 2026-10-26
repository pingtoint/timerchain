/**
 * 编辑器里的提醒设置面板。
 *
 * 开关 → 展开面板：重复模式 → 星期/日期 → 时间
 * 和 TimeStepper / SoundPicker 同构，都是"一个主行 + 展开子面板"的 Row 风格。
 */

import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { ensureBackgroundGuide } from '../notifications/backgroundGuide';
import { ensurePermission } from '../notifications/notificationService';
import { colors, radius, spacing } from '../theme';
import type { ReminderConfig, RepeatMode } from '../types';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { MonthDayMask } from './MonthDayMask';
import { RepeatPicker } from './RepeatPicker';
import { WeekdayMask } from './WeekdayMask';

interface Props {
  value: ReminderConfig | null;
  onChange: (next: ReminderConfig | null) => void;
}

/** 把 ReminderConfig 填成完整合法的 shape，null / 缺字段补默认值。 */
function normalizeInput(raw: ReminderConfig | null | undefined): ReminderConfig {
  if (raw === null || raw === undefined || !raw.enabled) {
    const d = new Date();
    d.setHours(8, 0, 0, 0);
    return {
      enabled: false,
      repeatMode: 'once',
      targetDate: d,
      timeOfDaySec: 8 * 3600,
      weeklyMask: '1,2,3,4,5',
      monthlyMask: '1,15',
      notificationSound: 'chime',
    };
  }
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  return {
    enabled: true,
    repeatMode: raw.repeatMode ?? 'once',
    targetDate: raw.targetDate ?? d,
    timeOfDaySec: raw.timeOfDaySec ?? 8 * 3600,
    weeklyMask: raw.weeklyMask ?? '1,2,3,4,5',
    monthlyMask: raw.monthlyMask ?? '1,15',
    notificationSound: raw.notificationSound ?? 'chime',
  };
}

/** timeOfDaySec → Date（当天，只用时间部分）。 */
function todToDate(sec: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setSeconds(sec);
  return d;
}

/** Date → timeOfDaySec（只用 hours + minutes）。 */
function dateToTodSec(d: Date): number {
  return d.getHours() * 3600 + d.getMinutes() * 60;
}

function formatTargetDate(d: Date | undefined): string {
  const date = d ?? new Date();
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatTod(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function ReminderRow({ value, onChange }: Props) {
  const state = normalizeInput(value);
  /**
   * Android 上 DateTimePicker 一挂载就立刻弹系统对话框 —— 绝不能内联渲染两个，
   * 否则日期和时间两个弹窗叠在一起、且每次 onChange 重渲染都会重新弹出，
   * 表现为"关不掉、反复弹"。正确姿势：按钮行 + 单实例条件挂载。
   * openPicker === null 时组件完全不挂载，系统对话框也就不会存在。
   */
  const [openPicker, setOpenPicker] = useState<null | 'date' | 'time'>(null);

  const onPickerChange = (event: DateTimePickerEvent, date?: Date) => {
    const mode = openPicker;
    // 无论确定还是取消，先卸载组件 —— 这是"能关掉"的关键
    setOpenPicker(null);
    if (event.type !== 'set' || date === undefined || mode === null) {
      return;
    }
    if (mode === 'date') {
      onChange({ ...state, targetDate: date });
    } else {
      onChange({ ...state, timeOfDaySec: dateToTodSec(date) });
    }
  };

  const togglePicker = (mode: 'date' | 'time') => {
    setOpenPicker((current) => (current === mode ? null : mode));
  };

  const toggleEnabled = (next: boolean) => {
    if (!next) {
      onChange({ ...state, enabled: false });
      return;
    }
    // 打开前先确认通知权限。被拒绝过（尤其国产 ROM 不弹系统框）时引导去设置页，
    // 否则用户会以为开了提醒，实际一条都排不上 —— 静默失败是最差的体验。
    void ensurePermission().then((granted) => {
      if (granted) {
        // 权限到手后再补一次"后台运行保障"引导（电池白名单/自启动，仅首次弹），随后放行
        void ensureBackgroundGuide().finally(() => {
          onChange({ ...state, enabled: true });
        });
        return;
      }
      Alert.alert(
        '需要通知权限',
        '系统关闭了 TimerChain 的通知权限，提醒无法送达。请到设置中允许通知后再打开。',
        [
          { text: '取消', style: 'cancel' },
          { text: '去设置', onPress: () => void Linking.openSettings() },
        ],
      );
    });
  };

  const setRepeatMode = (mode: RepeatMode) => {
    onChange({ ...state, repeatMode: mode });
  };

  const setWeeklyMask = (mask: string) => {
    onChange({ ...state, weeklyMask: mask });
  };

  const setMonthlyMask = (mask: string) => {
    onChange({ ...state, monthlyMask: mask });
  };

  // 面板展开条件：enabled 才展开
  if (!state.enabled) {
    return (
      <View style={styles.row}>
        <Icon name="notifications-outline" size={20} color="textSecondary" />
        <AppText variant="body" style={{ flex: 1 }}>
          定时提醒
        </AppText>
        <Switch
          value={false}
          onValueChange={toggleEnabled}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.bg}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Icon name="notifications" size={20} color="primary" />
        <AppText variant="body" style={{ flex: 1 }}>
          定时提醒
        </AppText>
        <Switch
          value
          onValueChange={toggleEnabled}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.bg}
        />
      </View>

      {/* 重复模式 */}
      <RepeatPicker value={state.repeatMode} onChange={setRepeatMode} />

      {/* weekly 的星期网格 */}
      {state.repeatMode === 'weekly' ? (
        <View style={styles.subRow}>
          <AppText variant="captionStrong" color="textSecondary">
            星期
          </AppText>
          <WeekdayMask mask={state.weeklyMask ?? ''} onChange={setWeeklyMask} />
        </View>
      ) : null}

      {/* monthly 的号数网格（31 个按钮 —— 一行放不下，用 ScrollView 让它可滚动） */}
      {state.repeatMode === 'monthly' ? (
        <View style={styles.subRow}>
          <AppText variant="captionStrong" color="textSecondary">
            每月几号
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: spacing.xs }}>
            <MonthDayMask mask={state.monthlyMask ?? ''} onChange={setMonthlyMask} />
          </ScrollView>
        </View>
      ) : null}

      {/* once 的日期选择：按钮行，点击才弹出系统选择器 */}
      {state.repeatMode === 'once' ? (
        <View style={styles.subRow}>
          <AppText variant="captionStrong" color="textSecondary">
            日期
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="选择日期"
            onPress={() => togglePicker('date')}
            style={styles.pickerButton}
          >
            <Icon name="calendar-outline" size={18} color="primary" />
            <AppText variant="body">{formatTargetDate(state.targetDate)}</AppText>
          </Pressable>
        </View>
      ) : null}

      {/* 时间选择（所有模式都显示） */}
      <View style={styles.subRow}>
        <AppText variant="captionStrong" color="textSecondary">
          时间
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="选择时间"
          onPress={() => togglePicker('time')}
          style={styles.pickerButton}
        >
          <Icon name="time-outline" size={18} color="primary" />
          <AppText variant="body">{formatTod(state.timeOfDaySec ?? 0)}</AppText>
        </Pressable>
      </View>

      {/* 全组件唯一的选择器实例：openPicker 为 null 时完全不挂载，
          Android 系统对话框因此只会在用户点击后出现，且确定/取消后必定关闭。 */}
      {openPicker !== null ? (
        <DateTimePicker
          value={
            openPicker === 'date'
              ? (state.targetDate ?? new Date())
              : todToDate(state.timeOfDaySec ?? 0)
          }
          mode={openPicker}
          display="default"
          onChange={onPickerChange}
          themeVariant="light"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  subRow: {
    gap: spacing.xs,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
});
