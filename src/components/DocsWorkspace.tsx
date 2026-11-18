import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  FileCode2,
  FileText,
  MessageSquarePlus,
  Sparkles,
  UploadCloud,
  Volume2,
  X,
} from 'lucide-react';
import { UI_TEXT } from '../i18n';
import { Language } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface DocsWorkspaceProps {
  language: Language;
  onSaveToSession: (title: string, prompt: string, result: string, attachmentSummary: string) => void;
  onContinueInChat: (seedPrompt: string, analysisResult: string) => void;
}

interface UploadedDoc {
  name: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
  previewUrl?: string;
}

export function DocsWorkspace({
  language,
  onSaveToSession,
  onContinueInChat,
}: DocsWorkspaceProps) {
  const t = UI_TEXT[language];
  const [docFile, setDocFile] = useState<UploadedDoc | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedTask, setSelectedTask] = useState<string>('summarize');
  const [result, setResult] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadFile = (file: File) => {
    if (file.size > 12 * 1024 * 1024) {
      setErrorMsg(
        language === 'ar' ? 'الحد الأقصى لحجم الملف هو 12 ميجابايت.' : 'Maximum file size is 12 MB.'
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const commaIdx = dataUrl.indexOf(',');
      const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
      const mime = file.type || 'text/plain';
      setDocFile({
        name: file.name,
        mimeType: mime,
        data: base64,
        sizeBytes: file.size,
        previewUrl: mime.startsWith('image/') ? dataUrl : undefined,
      });
      setErrorMsg(null);
    };
    reader.onerror = () => {
      setErrorMsg(language === 'ar' ? 'تعذر قراءة الملف.' : 'Failed to read file.');
    };
    reader.readAsDataURL(file);
  };

  const runAnalysis = async (taskOverride?: string) => {
    if (!docFile && !customPrompt.trim()) return;

    const activeTask = taskOverride || selectedTask;
    setSelectedTask(activeTask);
    setIsAnalyzing(true);
    setResult('');
    setErrorMsg(null);

    const taskPrompts: Record<string, Record<Language, string>> = {
      summarize: {
        ar: 'قدّم ملخصاً تنفيذياً شاملاً ومنظماً لمحتوى هذا الملف مع أهم الاستنتاجات.',
        en: 'Provide a clear, structured executive summary of this file along with core takeaways.',
      },
      keypoints: {
        ar: 'استخرج أهم النقاط والحقائق والأرقام الواردة في المحتوى على شكل قائمة مرقمة.',
        en: 'Extract the most important facts, entities, and key points as a clean structured list.',
      },
      ocr: {
        ar: 'استخرج كافة النصوص والبيانات الجدولية بدقة كما وردت وحافظ على تنسيقها.',
        en: 'Extract all visible text and structured data faithfully while preserving layout.',
      },
      review: {
        ar: 'راجع المحتوى أو الكود وحدد نقاط القوة، والأخطاء المحتملة، واقتراحات التحسين العملية.',
        en: 'Review the content or code thoroughly, identifying issues, gaps, and actionable improvements.',
      },
      translate: {
        ar: 'ترجم المحتوى إلى العربية الفصحى (أو إلى الإنجليزية إذا كان عربياً) بدقة عالية.',
        en: 'Translate the content cleanly between Arabic and English while preserving technical meaning.',
      },
    };

    const effectivePrompt = customPrompt.trim() || taskPrompts[activeTask]?.[language] || taskPrompts.summarize[language];
    let accumulated = '';

    try {
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: docFile
            ? { name: docFile.name, mimeType: docFile.mimeType, data: docFile.data }
            : undefined,
          prompt: effectivePrompt,
          taskType: activeTask,
          language,
        }),
      });

      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith('data:')) continue;
          try {
            const parsed = JSON.parse(line.slice(5).trim());
            if (parsed.type === 'chunk' && parsed.text) {
              accumulated += parsed.text;
              setResult(accumulated);
            } else if (parsed.type === 'error') {
              setErrorMsg(language === 'ar' ? parsed.messageAr : parsed.messageEn);
            }
          } catch {
            // ignore
          }
        }
      }

      if (accumulated.trim()) {
        onSaveToSession(
          docFile ? docFile.name : effectivePrompt.slice(0, 60),
          effectivePrompt,
          accumulated,
          docFile ? `${docFile.name} (${Math.round(docFile.sizeBytes / 1024)} KB)` : ''
        );
      }
    } catch {
      setErrorMsg(
        language === 'ar' ? 'حدث خطأ أثناء تحليل الملف.' : 'Error analyzing document.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  const handleListen = async () => {
    if (ttsPlaying && audioRef.current) {
      audioRef.current.pause();
      setTtsPlaying(false);
      return;
    }
    if (!result.trim()) return;

    setTtsLoading(true);
    try {
      const clean = result.replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>_]/g, '').trim();
      const resp = await fetch('/api/audio/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'single',
          text: clean.slice(0, 2500),
          voiceName: 'Kore',
          style: 'Clear, natural, expressive narrator',
        }),
      });
      const data = await resp.json();
      if (resp.ok && data.audioBase64) {
        const audio = new Audio(`data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`);
        audioRef.current = audio;
        audio.onended = () => setTtsPlaying(false);
        await audio.play();
        setTtsPlaying(true);
      }
    } catch {
      // ignore
    } finally {
      setTtsLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">{t.docsTitle}</h1>
          <p className="text-sm text-[var(--text-secondary)]">{t.docsSubtitle}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Upload & Controls Column */}
          <div className="lg:col-span-5 flex flex-col gap-4 p-4 sm:p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) loadFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border border-dashed p-6 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border-strong)] bg-[var(--bg-canvas)] hover:border-[var(--accent)]'
              }`}
            >
              <UploadCloud className="w-8 h-8 mx-auto mb-2.5 text-[var(--accent)]" />
              <p className="text-sm font-medium text-[var(--text-primary)]">{t.dropzoneTitle}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">{t.dropzoneHint}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,text/*,.md,.json,.csv,.js,.ts,.tsx,.py"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) loadFile(file);
                }}
              />
            </div>

            {docFile && (
              <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2.5">
                    {docFile.mimeType.includes('pdf') || docFile.mimeType.includes('text') ? (
                      <FileText className="w-4 h-4 shrink-0 text-[var(--accent)]" />
                    ) : (
                      <FileCode2 className="w-4 h-4 shrink-0 text-[var(--accent)]" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {docFile.name}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)] tabular-nums">
                        {(docFile.sizeBytes / 1024).toFixed(1)} KB · {docFile.mimeType}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDocFile(null)}
                    title={t.removeFile}
                    className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {docFile.previewUrl && (
                  <img
                    src={docFile.previewUrl}
                    alt={docFile.name}
                    referrerPolicy="no-referrer"
                    className="w-full max-h-48 object-contain rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]"
                  />
                )}
              </div>
            )}

            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2">
              {Object.entries(t.quickActions).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => runAnalysis(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    selectedTask === key
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={t.docsPromptPlaceholder}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none"
            />

            <button
              type="button"
              disabled={isAnalyzing || (!docFile && !customPrompt.trim())}
              onClick={() => runAnalysis()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>{isAnalyzing ? t.analyzing : t.analyzeBtn}</span>
            </button>

            {errorMsg && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Analysis Result Column */}
          <div className="lg:col-span-7 flex flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] min-h-[420px]">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                {t.quickActions[selectedTask as keyof typeof t.quickActions] || t.analyzeBtn}
              </span>
              {result && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] whitespace-nowrap"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? t.copied : t.copy}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleListen}
                    disabled={ttsLoading}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] whitespace-nowrap"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>{ttsPlaying ? t.stopAudio : t.listen}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onContinueInChat(
                        docFile ? `File: ${docFile.name}\n${customPrompt || ''}` : customPrompt,
                        result
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)] whitespace-nowrap"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                    <span>{t.sendToChat}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 p-5 overflow-y-auto">
              {isAnalyzing && !result ? (
                <div className="space-y-3 py-4">
                  <div className="h-4 w-2/3 rounded bg-[var(--bg-elevated)] animate-pulse" />
                  <div className="h-4 w-full rounded bg-[var(--bg-elevated)] animate-pulse" />
                  <div className="h-4 w-5/6 rounded bg-[var(--bg-elevated)] animate-pulse" />
                  <div className="h-4 w-1/2 rounded bg-[var(--bg-elevated)] animate-pulse" />
                </div>
              ) : result ? (
                <MarkdownRenderer content={result} language={language} />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center py-14 px-6">
                  <FileText className="w-10 h-10 text-[var(--text-muted)] mb-3 opacity-60" />
                  <p className="text-sm text-[var(--text-secondary)] max-w-md">{t.docsEmptyResult}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
