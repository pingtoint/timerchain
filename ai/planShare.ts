/**
 * 把任务链写成 .json 文件并调起系统分享。
 *
 * 用 expo-sharing 而不是 RN 内置 Share API：后者只能发"文本"，
 * 对方收到的是一段字符串；这里产出的是真正的文件，可以直接存进
 * 「文件」App、网盘，或发到微信/QQ 后另存。
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import type { Plan } from '../types';
import { buildPlanFileContent, planFileName } from './planFile';

export async function sharePlanFile(plan: Plan): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('当前设备不支持系统分享');
  }
  const uri = `${FileSystem.cacheDirectory}${planFileName(plan)}`;
  await FileSystem.writeAsStringAsync(uri, buildPlanFileContent(plan));
  await Sharing.shareAsync(uri, {
    mimeType: 'application/json',
    dialogTitle: `分享任务链「${plan.title}」`,
    UTI: 'public.json',
  });
}
