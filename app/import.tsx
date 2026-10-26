/**
 * 任务文件导入页。
 *
 * 导入内容有两个来源，解析路径是同一条（ai/parsePlan.ts）：
 * 1. 别人分享的 .json 任务链文件（文件选择器读取，或粘贴文件全文）；
 * 2. 大模型按文件结构改造后输出的 JSON（直接粘贴）。
 *
 * 文件格式见 ai/planFile.ts：顶层 { format, version, _readme, plan }，
 * parsePlanJson 容忍 { plan: {...} } 包装，所以两种来源零特判。
 */

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { parsePlanJson } from '../ai/parsePlan';
import { AppText, Button, Card, Dialog, Header, RenameDialog, Screen, TextField } from '../components';
import { usePlanStore } from '../store/planStore';
import { spacing } from '../theme';
import type { SavePlanInput } from '../types';
import { isDuplicateTitle, suggestUniqueTitle } from '../utils/duplicateName';
import { formatApproxDuration, formatPlanMeta, toErrorMessage } from '../utils/format';
import { planTotalDurationSec } from '../utils/plan';

export default function ImportScreen() {
  const router = useRouter();
  const savePlan = usePlanStore((state) => state.savePlan);
  const plans = usePlanStore((state) => state.plans);

  const [text, setText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SavePlanInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [renameVisible, setRenameVisible] = useState(false);
  /** 重名弹窗期间记住用户点的是「保存任务」还是「继续编辑」，改名后接着走同一条路。 */
  const pendingOpenEditor = useRef(false);

  const totalDurationSec = useMemo(
    () => (draft === null ? 0 : planTotalDurationSec(draft)),
    [draft],
  );

  const existingTitles = useMemo(() => plans.map((plan) => plan.title), [plans]);
  const isDuplicate = useMemo(
    () => draft !== null && isDuplicateTitle(draft.title, existingTitles),
    [draft, existingTitles],
  );
  const suggestedTitle = useMemo(
    () => (draft === null ? '' : suggestUniqueTitle(draft.title, existingTitles)),
    [draft, existingTitles],
  );

  const applyParseResult = useCallback((content: string) => {
    const result = parsePlanJson(content);
    if (!result.ok) {
      setDraft(null);
      setParseError(result.error);
      return;
    }
    setParseError(null);
    setDraft(result.draft);
    // 文件全文顺便填进文本框，用户能看到"刚才导入的是什么"
    setText(content);
  }, []);

  const pickFile = useCallback(() => {
    void (async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) {
        return;
      }
      const asset = picked.assets[0];
      if (asset === undefined) {
        return;
      }
      try {
        const content = await FileSystem.readAsStringAsync(asset.uri);
        applyParseResult(content);
      } catch {
        setParseError('文件读取失败，请重试或改为粘贴文件内容。');
      }
    })();
  }, [applyParseResult]);

  const parsePasted = useCallback(() => {
    applyParseResult(text);
  }, [applyParseResult, text]);

  const doPersist = useCallback(
    (input: SavePlanInput, openEditor: boolean) => {
      if (saving) {
        return;
      }
      setSaving(true);
      void (async () => {
        try {
          const saved = await savePlan(input);
          if (openEditor) {
            router.replace(`/edit?id=${saved.id}`);
          } else {
            router.back();
          }
        } catch (error) {
          setProblem(toErrorMessage(error));
        } finally {
          setSaving(false);
        }
      })();
    },
    [router, savePlan, saving],
  );

  const persist = useCallback(
    (openEditor: boolean) => {
      if (draft === null || saving) {
        return;
      }
      // 重名拦截：先改名再保存（弹窗确认后回到这里）
      if (isDuplicateTitle(draft.title, existingTitles)) {
        pendingOpenEditor.current = openEditor;
        setRenameVisible(true);
        return;
      }
      doPersist(draft, openEditor);
    },
    [draft, doPersist, existingTitles, saving],
  );

  const confirmRename = useCallback(
    (newTitle: string) => {
      if (draft === null) {
        return;
      }
      const renamed: SavePlanInput = { ...draft, title: newTitle };
      setDraft(renamed);
      setRenameVisible(false);
      doPersist(renamed, pendingOpenEditor.current);
    },
    [draft, doPersist],
  );

  return (
    <Screen variant="grouped">
      <Header title="导入任务" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.card}>
          <AppText variant="bodyStrong" style={styles.cardTitle}>
            选择任务文件
          </AppText>
          <AppText variant="caption" color="textSecondary" style={styles.cardHint}>
            支持别人分享的 TimerChain .json 文件；文件里的结构说明也会告诉 AI
            如何按相同格式改造它。
          </AppText>
          <Button
            label="从文件中选择"
            icon="folder-open-outline"
            variant="secondary"
            fullWidth
            onPress={pickFile}
          />
        </Card>

        <Card style={styles.card}>
          <AppText variant="bodyStrong" style={styles.cardTitle}>
            或粘贴内容
          </AppText>
          <TextField
            value={text}
            onChangeText={(value) => {
              setText(value);
              setParseError(null);
            }}
            placeholder="粘贴任务文件全文，或 AI 按相同结构改造后的 JSON"
            error={parseError}
            multiline
            minLines={5}
          />
          <Button
            label="解析预览"
            icon="scan-outline"
            variant="secondary"
            fullWidth
            style={styles.parseButton}
            disabled={text.trim().length === 0}
            onPress={parsePasted}
          />
        </Card>

        {draft === null ? null : (
          <Card style={styles.card}>
            <AppText variant="bodyStrong" style={styles.cardTitle}>
              预览并保存
            </AppText>
            <AppText variant="title">{draft.title}</AppText>
            <AppText variant="caption" color="textSecondary" style={styles.previewMeta}>
              {formatPlanMeta(draft.steps.length, totalDurationSec)}
            </AppText>
            {isDuplicate ? (
              <AppText variant="caption" color="warning">
                已有同名任务，保存时需要重命名
              </AppText>
            ) : null}

            <View style={styles.stepList}>
              {draft.steps.map((step, index) => (
                <View key={step.id} style={styles.stepRow}>
                  <AppText variant="body" style={styles.stepText}>
                    {index + 1}. {step.title} · {formatApproxDuration(step.durationSec)}
                  </AppText>
                  {step.restAfterSec > 0 ? (
                    <AppText variant="caption" color="textSecondary">
                      休息 {formatApproxDuration(step.restAfterSec)}
                    </AppText>
                  ) : null}
                </View>
              ))}
            </View>

            <View style={styles.buttonRow}>
              <Button
                label="保存任务"
                icon="checkmark"
                style={styles.buttonFlex}
                loading={saving}
                onPress={() => persist(false)}
              />
              <Button
                label="继续编辑"
                icon="create-outline"
                variant="ghost"
                style={styles.buttonFlex}
                disabled={saving}
                onPress={() => persist(true)}
              />
            </View>
          </Card>
        )}
      </ScrollView>

      <Dialog
        visible={problem !== null}
        title="保存失败"
        message={problem ?? undefined}
        confirmLabel="知道了"
        cancelLabel={null}
        onCancel={() => setProblem(null)}
        onConfirm={() => setProblem(null)}
      />

      {renameVisible ? (
        <RenameDialog
          visible
          originalTitle={draft?.title ?? ''}
          initialTitle={suggestedTitle}
          existingTitles={existingTitles}
          onConfirm={confirmRename}
          onCancel={() => setRenameVisible(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  card: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: {
    marginBottom: spacing.xs,
  },
  cardHint: {
    marginTop: -spacing.xs,
  },
  parseButton: {
    marginTop: spacing.xs,
  },
  previewMeta: {
    marginTop: -spacing.xs,
  },
  stepList: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepText: {
    flex: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  buttonFlex: {
    flex: 1,
  },
});
