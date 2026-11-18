import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  MessageSquarePlus,
  Mic,
  Plus,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import { UI_TEXT } from '../i18n';
import { Language } from '../types';

interface AudioWorkspaceProps {
  language: Language;
  onSendTranscriptToChat: (text: string) => void;
}

interface DialogueLine {
  speaker: string;
  text: string;
  style: string;
}

const VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'] as const;

export function AudioWorkspace({ language, onSendTranscriptToChat }: AudioWorkspaceProps) {
  const t = UI_TEXT[language];
  const [subTab, setSubTab] = useState<'stt' | 'tts'>('stt');

  // STT State
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [copiedTranscript, setCopiedTranscript] = useState(false);

  // TTS State
  const [ttsMode, setTtsMode] = useState<'single' | 'dual'>('single');
  const [ttsText, setTtsText] = useState('');
  const [voiceName, setVoiceName] = useState<string>('Kore');
  const [ttsStyle, setTtsStyle] = useState<string>(t.ttsStyles[0].id);
  const [podcastTopic, setPodcastTopic] = useState('');
  const [speaker1Voice, setSpeaker1Voice] = useState<string>('Puck');
  const [speaker2Voice, setSpeaker2Voice] = useState<string>('Kore');
  const [dialogueLines, setDialogueLines] = useState<DialogueLine[]>(
    language === 'ar'
      ? [
          {
            speaker: 'طارق',
            text: 'أهلاً بكم في حلقة اليوم حول تطبيقات الذكاء الاصطناعي في حياتنا اليومية.',
            style: 'Warm, engaging podcast host',
          },
          {
            speaker: 'ليلى',
            text: 'مرحباً طارق، بالتأكيد أصبحت الأدوات الذكية جزءاً أساسياً من إنتاجيتنا.',
            style: 'Insightful, articulate co-host',
          },
        ]
      : [
          {
            speaker: 'Alex',
            text: 'Welcome back! Today we are exploring how multimodal AI reshapes daily workflows.',
            style: 'Warm, engaging podcast host',
          },
          {
            speaker: 'Sam',
            text: 'Glad to be here, Alex. Voice and document tools have made huge strides recently.',
            style: 'Insightful, articulate co-host',
          },
        ]
  );

  const [isWritingScript, setIsWritingScript] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    };
  }, []);

  const transcribeBlob = async (blob: Blob, mimeType: string) => {
    setIsTranscribing(true);
    setErrorMsg(null);
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const s = String(reader.result || '');
          resolve(s.includes(',') ? s.split(',')[1] : s);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });

      const resp = await fetch('/api/audio/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mimeType, data: base64, language }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErrorMsg(language === 'ar' ? data.error : data.errorEn || data.error);
      } else {
        setTranscript(data.text || '');
      }
    } catch {
      setErrorMsg(language === 'ar' ? 'فشل تفريغ الملف الصوتي.' : 'Audio transcription failed.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const toggleRecording = async () => {
    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setAudioLevel(0);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const mime = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mime });
        transcribeBlob(blob, mime);
      };

      // Live meter via Web Audio API
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const dataArr = new Uint8Array(analyser.frequencyBinCount);
      const tickMeter = () => {
        analyser.getByteFrequencyData(dataArr);
        const avg = dataArr.reduce((sum, v) => sum + v, 0) / dataArr.length;
        setAudioLevel(Math.min(100, Math.round((avg / 180) * 100)));
        rafRef.current = requestAnimationFrame(tickMeter);
      };
      tickMeter();

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecordSeconds(0);
      setIsRecording(true);
      setErrorMsg(null);
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setErrorMsg(
        language === 'ar'
          ? 'يرجى السماح بالوصول إلى الميكروفون للتسجيل.'
          : 'Please allow microphone access to record audio.'
      );
    }
  };

  const handleAudioFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setErrorMsg(language === 'ar' ? 'الحد الأقصى للملف الصوتي 15 ميجابايت.' : 'Max audio file size is 15 MB.');
      return;
    }
    transcribeBlob(file, file.type || 'audio/mp3');
  };

  const handleAutoWriteScript = async () => {
    if (!podcastTopic.trim() || isWritingScript) return;
    setIsWritingScript(true);
    setErrorMsg(null);
    try {
      const resp = await fetch('/api/audio/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: podcastTopic.trim(), language }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErrorMsg(language === 'ar' ? data.error : data.errorEn || data.error);
      } else if (Array.isArray(data.lines) && data.lines.length >= 2) {
        setDialogueLines(data.lines);
      }
    } catch {
      setErrorMsg(language === 'ar' ? 'تعذر كتابة الحوار.' : 'Failed to generate dialogue script.');
    } finally {
      setIsWritingScript(false);
    }
  };

  const handleGenerateSpeech = async () => {
    if (isGeneratingAudio) return;
    setIsGeneratingAudio(true);
    setErrorMsg(null);

    try {
      const payload =
        ttsMode === 'single'
          ? { mode: 'single', text: ttsText, voiceName, style: ttsStyle }
          : {
              mode: 'dual',
              dialogueLines: dialogueLines.filter((l) => l.text.trim()),
              speaker1Voice,
              speaker2Voice,
            };

      const resp = await fetch('/api/audio/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok || !data.audioBase64) {
        setErrorMsg(language === 'ar' ? data.error : data.errorEn || data.error || 'TTS failed');
        return;
      }
      setGeneratedAudioUrl(`data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`);
    } catch {
      setErrorMsg(language === 'ar' ? 'تعذر توليد الصوت.' : 'Failed to synthesize speech.');
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const formatTimer = (sec: number) => {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">{t.audioTitle}</h1>
            <p className="text-sm text-[var(--text-secondary)]">{t.audioSubtitle}</p>
          </div>

          <div className="inline-flex p-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <button
              type="button"
              onClick={() => setSubTab('stt')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                subTab === 'stt'
                  ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t.tabStt}
            </button>
            <button
              type="button"
              onClick={() => setSubTab('tts')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                subTab === 'tts'
                  ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t.tabTts}
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {subTab === 'stt' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            <div className="lg:col-span-5 p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col justify-between gap-5">
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={toggleRecording}
                  disabled={isTranscribing}
                  className={`w-full py-4 px-4 rounded-xl border text-sm font-semibold inline-flex items-center justify-center gap-2.5 transition-colors ${
                    isRecording
                      ? 'border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]'
                      : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]'
                  }`}
                >
                  {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  <span>{isRecording ? t.stopRecording : t.recordVoice}</span>
                </button>

                {/* Live Mic Meter & Timer */}
                <div className="p-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] space-y-2">
                  <div className="flex items-center justify-between text-xs text-[var(--text-muted)] tabular-nums">
                    <span>{isRecording ? (language === 'ar' ? 'جاري التسجيل' : 'Recording') : (language === 'ar' ? 'جاهز' : 'Ready')}</span>
                    <span className="font-mono text-[var(--text-primary)]">{formatTimer(recordSeconds)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent)] transition-all duration-75"
                      style={{ width: `${audioLevel}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  disabled={isTranscribing || isRecording}
                  onClick={() => audioFileInputRef.current?.click()}
                  className="w-full py-2.5 px-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] inline-flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <Upload className="w-4 h-4" />
                  <span>{isTranscribing ? t.transcribing : t.uploadAudio}</span>
                </button>
                <input
                  ref={audioFileInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={handleAudioFileUpload}
                />
              </div>
            </div>

            <div className="lg:col-span-7 p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  {t.transcriptLabel}
                </span>
                {transcript && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(transcript);
                        setCopiedTranscript(true);
                        setTimeout(() => setCopiedTranscript(false), 1600);
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                    >
                      {copiedTranscript ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedTranscript ? t.copied : t.copy}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onSendTranscriptToChat(transcript)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]"
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5" />
                      <span>{t.sendToChat}</span>
                    </button>
                  </div>
                )}
              </div>

              <textarea
                rows={10}
                value={isTranscribing ? t.transcribing : transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder={t.transcriptPlaceholder}
                className="flex-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none"
              />
            </div>
          </div>
        ) : (
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-5">
            {/* Single vs Dual Speaker Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex p-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
                <button
                  type="button"
                  onClick={() => setTtsMode('single')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    ttsMode === 'single'
                      ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {t.ttsModeSingle}
                </button>
                <button
                  type="button"
                  onClick={() => setTtsMode('dual')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    ttsMode === 'dual'
                      ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {t.ttsModeDual}
                </button>
              </div>
            </div>

            {ttsMode === 'single' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="space-y-1.5 block">
                    <span className="text-xs font-medium text-[var(--text-muted)]">{t.voiceLabel}</span>
                    <select
                      value={voiceName}
                      onChange={(e) => setVoiceName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                    >
                      {VOICES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5 block">
                    <span className="text-xs font-medium text-[var(--text-muted)]">{t.styleLabel}</span>
                    <select
                      value={ttsStyle}
                      onChange={(e) => setTtsStyle(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                    >
                      {t.ttsStyles.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <textarea
                  rows={5}
                  value={ttsText}
                  onChange={(e) => setTtsText(e.target.value)}
                  placeholder={t.ttsTextPlaceholder}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />

                <button
                  type="button"
                  disabled={!ttsText.trim() || isGeneratingAudio}
                  onClick={handleGenerateSpeech}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>{isGeneratingAudio ? t.generatingSpeech : t.generateSpeech}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Auto Script Generator */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={podcastTopic}
                    onChange={(e) => setPodcastTopic(e.target.value)}
                    placeholder={t.podcastTopicPlaceholder}
                    className="flex-1 px-3.5 py-2 rounded-lg text-sm bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    disabled={!podcastTopic.trim() || isWritingScript}
                    onClick={handleAutoWriteScript}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{isWritingScript ? t.generatingScript : t.autoWriteScript}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="space-y-1.5 block">
                    <span className="text-xs font-medium text-[var(--text-muted)]">{t.speaker1}</span>
                    <select
                      value={speaker1Voice}
                      onChange={(e) => setSpeaker1Voice(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                    >
                      {VOICES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-xs font-medium text-[var(--text-muted)]">{t.speaker2}</span>
                    <select
                      value={speaker2Voice}
                      onChange={(e) => setSpeaker2Voice(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                    >
                      {VOICES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="space-y-2.5">
                  {dialogueLines.map((line, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]"
                    >
                      <input
                        type="text"
                        value={line.speaker}
                        onChange={(e) => {
                          const next = [...dialogueLines];
                          next[idx] = { ...line, speaker: e.target.value };
                          setDialogueLines(next);
                        }}
                        className="w-24 shrink-0 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                      />
                      <input
                        type="text"
                        value={line.text}
                        onChange={(e) => {
                          const next = [...dialogueLines];
                          next[idx] = { ...line, text: e.target.value };
                          setDialogueLines(next);
                        }}
                        className="flex-1 px-2.5 py-1.5 rounded-md text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                      />
                      {dialogueLines.length > 2 && (
                        <button
                          type="button"
                          onClick={() =>
                            setDialogueLines((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setDialogueLines((prev) => [
                        ...prev,
                        {
                          speaker: prev[prev.length % 2]?.speaker || (language === 'ar' ? 'طارق' : 'Alex'),
                          text: '',
                          style: 'Natural conversational tone',
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t.addLine}</span>
                  </button>
                </div>

                <button
                  type="button"
                  disabled={isGeneratingAudio || dialogueLines.filter((l) => l.text.trim()).length < 2}
                  onClick={handleGenerateSpeech}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>{isGeneratingAudio ? t.generatingSpeech : t.synthesizePodcast}</span>
                </button>
              </div>
            )}

            {generatedAudioUrl && (
              <div className="pt-4 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row items-center gap-3">
                <audio controls src={generatedAudioUrl} className="w-full sm:flex-1 h-10" />
                <a
                  href={generatedAudioUrl}
                  download={`nuha-speech-${Date.now()}.wav`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t.downloadWav}</span>
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
