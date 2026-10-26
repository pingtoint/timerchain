/**
 * AI 生成任务页（方案 A：剪贴板往返）。
 *
 * ── 为什么不直接调 API ─────────────────────────────────────────────
 * 免费大模型里，网页版（chat.deepseek.com 等）没有开放接口，App 无法
 * 程序化调用。所以这一步走"复制提示词 → 用户粘贴给网页 AI → 复制回复
 * → 回 App 解析"的人工往返。提示词模板（ai/planTemplate.ts）与解析器
 * （ai/parsePlan.ts）与将来 API 直连（方案 B）完全共用，届时只把
 * 「复制/粘贴」这两步替换成一次 HTTP 请求。
 *
 * ── 页面结构 ───────────────────────────────────────────────────────
 * 三张卡片对应用户的三步操作，第④张（预览）只在解析成功后出现：
 * ① 描述安排 → ② 复制提示词发给 AI → ③ 粘贴回复 → ④ 预览并保存。
 */

import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AI_APPS, detectAiApps, openAiApp, openAiWebDefault, type AiApp } from '../ai/aiApps';
import { parsePlanJson } from '../ai/parsePlan';
import { buildPlanPrompt } from '../ai/planTemplate';
import { generatePlanFromText, type AiSettings } from '../ai/provider';
import { loadAiSettings } from '../ai/settings';
import { AppText, Button, Card, Dialog, Header, Icon, RenameDialog, Screen, TextField } from '../components';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { usePlanStore } from '../store/planStore';
import { colors, spacing } from '../theme';
import type { SavePlanInput } from '../types';
import { isDuplicateTitle, suggestUniqueTitle } from '../utils/duplicateName';
import { formatApproxDuration, formatPlanMeta, toErrorMessage } from '../utils/format';
import { planTotalDurationSec } from '../utils/plan';

const COPIED_FEEDBACK_MS = 2000;

export default function AiImportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string }>();
  const initialText = typeof params.text === 'string' ? params.text : '';

  const savePlan = usePlanStore((state) => state.savePlan);
  const plans = usePlanStore((state) => state.plans);

  const [description, setDescription] = useState(initialText);
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SavePlanInput | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [renameVisible, setRenameVisible] = useState(false);
  /** 重名弹窗期间记住用户点的是「保存任务」还是「继续编辑」，改名后接着走同一条路。 */
  const pendingOpenEditor = useRef(false);

  const existingTitles = useMemo(() => plans.map((plan) => plan.title), [plans]);
  const isDuplicate = useMemo(
    () => draft !== null && isDuplicateTitle(draft.title, existingTitles),
    [draft, existingTitles],
  );
  const suggestedTitle = useMemo(
    () => (draft === null ? '' : suggestUniqueTitle(draft.title, existingTitles)),
    [draft, existingTitles],
  );

  // ── 语音输入 ──────────────────────────────────────────────────────
  const speech = useSpeechRecognition();
  const [voiceHelp, setVoiceHelp] = useState<string | null>(null);
  useEffect(() => {
    if (speech.transcript.length === 0) {
      return;
    }
    // 实时把增量片段追加到文本框（按句子分段拼接，保留空格）
    setDescription((prev) => {
      if (speech.segments.length === 0) {
        // 还没 finalize 过任何片段：直接替换
        return speech.transcript;
      }
      // 已经有 finalize 过的片段：拼起来 + 当前增量
      const segments = [...speech.segments, speech.transcript];
      return segments.join(' ');
    });
  }, [speech.transcript, speech.segments]);

  // ── AI App 探测与选择 ─────────────────────────────────────────────
  const [detectedApps, setDetectedApps] = useState<AiApp[]>([]);
  const [aiPickerVisible, setAiPickerVisible] = useState(false);
  const [aiPickError, setAiPickError] = useState<string | null>(null);

  const openAiPicker = useCallback(async () => {
    const apps = await detectAiApps();
    if (apps.length === 0) {
      setAiPickError('手机上没检测到主流 AI App（DeepSeek / 豆包 / Kimi 等），是否改为打开任意 AI 网页版？');
      return;
    }
    if (apps.length === 1) {
      await openAiApp(apps[0]);
      return;
    }
    setDetectedApps(apps);
    setAiPickerVisible(true);
  }, []);

  const chooseAi = useCallback(async (app: AiApp) => {
    setAiPickerVisible(false);
    await openAiApp(app);
  }, []);

  // ── 方案 B：配置过 API Key 时，②号卡片顶部出现「直接生成」 ──
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [generating, setGenerating] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void loadAiSettings().then(setAiSettings);
    }, []),
  );

  const descriptionEmpty = description.trim().length === 0;
  const totalDurationSec = useMemo(
    () => (draft === null ? 0 : planTotalDurationSec(draft)),
    [draft],
  );

  const copyPrompt = useCallback(() => {
    if (descriptionEmpty) {
      return;
    }
    void Clipboard.setStringAsync(buildPlanPrompt(description)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    });
  }, [description, descriptionEmpty]);

  const parseReply = useCallback(() => {
    const result = parsePlanJson(reply);
    if (!result.ok) {
      setDraft(null);
      setReplyError(result.error);
      return;
    }
    setReplyError(null);
    setDraft(result.draft);
  }, [reply]);

  /** 方案 B：一次 HTTP 请求直达预览，失败时保留剪贴板路径作为退路。 */
  const generateDirect = useCallback(() => {
    if (aiSettings === null || descriptionEmpty || generating) {
      return;
    }
    setGenerating(true);
    setReplyError(null);
    void (async () => {
      try {
        const result = await generatePlanFromText(aiSettings, description);
        if (!result.ok) {
          setProblem(`${result.error}\n\n也可以改用下面的「复制提示词」手动方式。`);
          return;
        }
        setDraft(result.draft);
      } finally {
        setGenerating(false);
      }
    })();
  }, [aiSettings, description, descriptionEmpty, generating]);

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
      <Header title="AI 生成任务" onBack={() => router.back()} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Card style={styles.card}>
            <AppText variant="bodyStrong" style={styles.cardTitle}>
              ① 描述你的安排
            </AppText>
            <View style={styles.inputRow}>
              <View style={styles.inputFlex}>
                <TextField
                  value={description}
                  onChangeText={setDescription}
                  placeholder="例如：早上先洗漱 10 分钟，冥想一刻钟，然后晨跑半小时，跑完休息 5 分钟再拉伸 10 分钟"
                  multiline
                  minLines={4}
                  maxLength={2000}
                />
              </View>
              <Pressable
                accessibilityLabel={speech.listening ? '停止录音' : '语音输入'}
                accessibilityState={{ disabled: speech.unavailable }}
                hitSlop={spacing.sm}
                disabled={speech.unavailable}
                onPress={() => {
                  if (speech.listening) {
                    void speech.stop();
                  } else {
                    void speech.start().catch(() => undefined);
                  }
                }}
                style={[styles.voiceBtn, speech.listening ? styles.voiceBtnRecording : null, speech.unavailable ? styles.voiceBtnDisabled : null]}
              >
                <Icon
                  name={speech.listening ? 'mic-off-outline' : 'mic-outline'}
                  size={20}
                  color={speech.listening ? 'textOnPrimary' : speech.unavailable ? 'textSecondary' : 'primary'}
                />
              </Pressable>
            </View>
            {speech.listening ? (
              <AppText variant="caption" color="primary" style={styles.voiceHint}>
                正在聆听…说完再点一次结束
              </AppText>
            ) : speech.unavailable ? (
              <AppText variant="caption" color="textSecondary" style={styles.voiceHint}>
                当前设备不支持语音识别（Android 需安装 Google App 或系统语音包）
              </AppText>
            ) : voiceHelp !== null ? (
              <AppText variant="caption" color="textSecondary" style={styles.voiceHint}>
                {voiceHelp}
              </AppText>
            ) : null}
          </Card>

          <Card style={styles.card}>
            <AppText variant="bodyStrong" style={styles.cardTitle}>
              ② 让 AI 生成
            </AppText>

            {aiSettings === null ? null : (
              <Button
                label="直接生成"
                icon="sparkles"
                fullWidth
                style={styles.directButton}
                disabled={descriptionEmpty}
                loading={generating}
                onPress={generateDirect}
              />
            )}

            <AppText variant="caption" color="textSecondary" style={styles.cardHint}>
              {aiSettings === null
                ? '提示词已包含任务模板，粘贴给 DeepSeek（或任意大模型）即可，它会返回一段 JSON。也可以到「设置」里配置 API Key 一键直连。'
                : '手动方式：复制提示词发给任意大模型（DeepSeek / 豆包 / Kimi），它会返回一段 JSON。'}
            </AppText>
            <View style={styles.buttonRow}>
              <Button
                label={copied ? '已复制 ✓' : '复制提示词'}
                icon="clipboard-outline"
                variant="secondary"
                style={styles.buttonFlex}
                disabled={descriptionEmpty}
                onPress={copyPrompt}
              />
              <Button
                label="打开 AI App"
                icon="chatbubbles-outline"
                variant="ghost"
                style={styles.buttonFlex}
                onPress={openAiPicker}
              />
            </View>
          </Card>

          <Card style={styles.card}>
            <AppText variant="bodyStrong" style={styles.cardTitle}>
              ③ 粘贴 AI 的回复
            </AppText>
            <TextField
              value={reply}
              onChangeText={(text) => {
                setReply(text);
                setReplyError(null);
              }}
              placeholder='粘贴 AI 返回的 JSON，例如 {"title":"晨间例行","steps":[...]}'
              error={replyError}
              multiline
              minLines={4}
            />
            <Button
              label="解析预览"
              icon="sparkles-outline"
              variant="secondary"
              fullWidth
              style={styles.parseButton}
              disabled={reply.trim().length === 0}
              onPress={parseReply}
            />
          </Card>

          {draft === null ? null : (
            <Card style={styles.card}>
              <AppText variant="bodyStrong" style={styles.cardTitle}>
                ④ 预览并保存
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
      </KeyboardAvoidingView>

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

      {/* AI App 选择器（Dialog 不支持 children，用 Modal + 自定义列表） */}
      <Modal visible={aiPickerVisible} transparent animationType="fade" onRequestClose={() => setAiPickerVisible(false)}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setAiPickerVisible(false)}
        >
          <Pressable style={styles.modalSheet} onPress={() => undefined}>
            <AppText variant="bodyStrong" style={styles.modalTitle}>
              选择一个 AI App
            </AppText>
            <AppText variant="caption" color="textSecondary" style={styles.modalHint}>
              检测到以下已安装的 AI 应用
            </AppText>
            <View style={styles.aiList}>
              {detectedApps.map((app) => (
                <Pressable
                  key={app.id}
                  accessibilityLabel={`打开 ${app.label}`}
                  hitSlop={spacing.sm}
                  style={styles.aiItem}
                  onPress={() => void chooseAi(app)}
                >
                  <Icon name="chatbubbles-outline" size={22} color="primary" />
                  <AppText variant="body" style={styles.aiItemLabel}>
                    {app.label}
                  </AppText>
                  <Icon name="chevron-forward-outline" size={18} color="textSecondary" />
                </Pressable>
              ))}
            </View>
            <Button
              label="取消"
              variant="ghost"
              fullWidth
              onPress={() => setAiPickerVisible(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* 没找到 AI App：问用户要不要改开网页 */}
      <Dialog
        visible={aiPickError !== null}
        title="没检测到 AI App"
        message={aiPickError ?? undefined}
        confirmLabel="打开网页版"
        cancelLabel="知道了"
        onCancel={() => setAiPickError(null)}
        onConfirm={() => {
          setAiPickError(null);
          void openAiWebDefault();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
  directButton: {
    marginBottom: spacing.xs,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  buttonFlex: {
    flex: 1,
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  inputFlex: {
    flex: 1,
  },
  voiceBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    marginTop: 4, // 与 TextField 顶对齐
  },
  voiceBtnRecording: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  voiceBtnDisabled: {
    opacity: 0.5,
  },
  voiceHint: {
    marginTop: -spacing.xs,
  },
  aiList: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  aiItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: 8,
  },
  aiItemLabel: {
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.bg,
    padding: spacing.lg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  modalTitle: {
    textAlign: 'center',
  },
  modalHint: {
    textAlign: 'center',
    marginTop: -spacing.xs,
  },
});
