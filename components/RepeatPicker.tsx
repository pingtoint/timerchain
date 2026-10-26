/**
 * 重复模式选择器 —— 四个按钮一行
 *
 * 每天 / 每周 / 每月 / 仅一次。选中的按钮高亮。
 * 用 SegmentedControl 实现（项目已装）。
 */

import { spacing } from '../theme';
import type { RepeatMode } from '../types';
import { SegmentedControl } from './SegmentedControl';

interface Props {
  value: RepeatMode;
  onChange: (mode: RepeatMode) => void;
}

const OPTIONS: { value: RepeatMode; label: string }[] = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'once', label: '仅一次' },
];

export function RepeatPicker({ value, onChange }: Props) {
  return (
    <SegmentedControl
      options={OPTIONS}
      value={value}
      onChange={onChange}
      style={{ marginTop: spacing.sm }}
    />
  );
}
