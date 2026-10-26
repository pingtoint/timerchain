/**
 * 语音转文字 hook：薄封装 expo-speech-recognition。
 *
 * ── Android 上的坑 ───────────────────────────────────────────────
 * expo-speech-recognition 底层走系统 SpeechRecognizer，Android 上通常需要用户
 * 安装 Google App 或装了系统语音包。没有的话 start() 会 reject，这里降级为
 * 返回 unavailable: true 并禁用按钮。
 *
 * ── 与 TextField 的集成 ──────────────────────────────────────────
 * 返回的 transcript 是当前会话的**增量结果**，调用方自己决定：
 * - 每收到增量就 append 到现有文字（实时输入）；
 * - 还是只在会话结束时一次性替换整块文字（避免抖动）。
 * 这里选择前者，体验更自然。
 */

import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseSpeechRecognitionResult {
  /** 是否正在录音识别。 */
  listening: boolean;
  /** 识别到的当前文字片段（增量）。 */
  transcript: string;
  /** 上一次识别出的完整句子；用于追加到文本框。 */
  segments: string[];
  /** 系统没有可用的语音识别服务。 */
  unavailable: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useSpeechRecognition(): UseSpeechRecognitionResult {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [segments, setSegments] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  // 用 ref 保留最新 listening，避免事件闭包陈旧
  const listeningRef = useRef(false);

  useEffect(() => {
    // 不阻塞启动，第一次按录音按钮再请求权限
    const sub = ExpoSpeechRecognitionModule.addListener('result', (event) => {
      if (!listeningRef.current) {
        return;
      }
      const latest = event.results[event.results.length - 1];
      const text = latest?.transcript ?? '';
      // ExpoSpeechRecognitionResult 没有 isFinal 字段，用 confidence 近似：
      // confidence 接近 1 视为 final，小于阈值视为 interim
      const confidence = (latest as { confidence?: number } | undefined)?.confidence ?? 0;
      setTranscript(text);
      if (confidence > 0.8 && text.trim().length > 0) {
        setSegments((prev) => [...prev, text]);
      }
    });

    const startSub = ExpoSpeechRecognitionModule.addListener('start', () => {
      setListening(true);
      listeningRef.current = true;
    });
    const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
      setListening(false);
      listeningRef.current = false;
      setTranscript('');
    });
    const errSub = ExpoSpeechRecognitionModule.addListener('error', () => {
      // 任何错误一律降级为 unavailable，用户改走粘贴
      setUnavailable(true);
      setListening(false);
      listeningRef.current = false;
    });

    return () => {
      sub.remove();
      startSub.remove();
      endSub.remove();
      errSub.remove();
    };
  }, []);

  const start = useCallback(async () => {
    if (listeningRef.current || unavailable) {
      return;
    }
    try {
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      await ExpoSpeechRecognitionModule.start({
        lang: 'zh-CN',
        interimResults: true,
        maxAlternatives: 1,
      });
    } catch {
      setUnavailable(true);
    }
  }, [unavailable]);

  const stop = useCallback(async () => {
    if (!listeningRef.current) {
      return;
    }
    try {
      await ExpoSpeechRecognitionModule.stop();
    } catch {
      // 结束时的错误忽略
    }
  }, []);

  return { listening, transcript, segments, unavailable, start, stop };
}
