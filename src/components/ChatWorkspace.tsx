import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Link2,
  Mic,
  Paperclip,
  Send,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import { PERSONA_INSTRUCTIONS, UI_TEXT } from '../i18n';
import { exportConversationMarkdown, generateId } from '../storage';
import {
  AttachmentPayload,
  ChatMessage,
  Conversation,
  GroundingSource,
  Language,
  PersonaId,
  ThinkingDepth,
} from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ChatWorkspaceProps {
  language: Language;
  conversation: Conversation;
  incognito: boolean;
  onUpdateConversation: (conv: Conversation, newMessagesToSync?: ChatMessage[]) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ChatWorkspace({
  language,
  conversation,
  incognito,
  onUpdateConversation,
}: ChatWorkspaceProps) {
  const t = UI_TEXT[language];
  const [input, setInput] = useState('');
  const [persona, setPersona] = useState<PersonaId>(conversation.persona || 'general');
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingDepth>('HIGH');
  const [useSearch, setUseSearch] = useState(false);
  const [useUrlContext, setUseUrlContext] = useState(false);
  const [attachment, setAttachment] = useState<AttachmentPayload | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Audio playback for Read Aloud
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const [ttsPlayingId, setTtsPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Voice dictation recording
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribingMic, setIsTranscribingMic] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPersona(conversation.persona || 'general');
    setErrorMsg(null);
  }, [conversation.id, conversation.persona]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation.messages.length, streamingContent]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      setErrorMsg(
        language === 'ar' ? 'حجم الملف يتجاوز 12 ميجابايت.' : 'File size exceeds 12 MB limit.'
      );
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      setAttachment({
        name: file.name,
        mimeType: file.type || 'text/plain',
        data: base64,
        sizeBytes: file.size,
      });
      setErrorMsg(null);
    } catch {
      setErrorMsg(language === 'ar' ? 'تعذر قراءة الملف.' : 'Failed to read file.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleMicRecording = async () => {
    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setIsTranscribingMic(true);
        try {
          const reader = new FileReader();
          const b64: string = await new Promise((res, rej) => {
            reader.onload = () => {
              const s = String(reader.result || '');
              res(s.includes(',') ? s.split(',')[1] : s);
            };
            reader.onerror = () => rej(reader.error);
            reader.readAsDataURL(blob);
          });
          const resp = await fetch('/api/audio/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mimeType: blob.type || 'audio/webm',
              data: b64,
              language,
            }),
          });
          const data = await resp.json();
          if (!resp.ok) {
            setErrorMsg(data.error || 'Transcription failed');
          } else if (data.text) {
            setInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
          }
        } catch {
          setErrorMsg(language === 'ar' ? 'تعذر تحويل الصوت إلى نص.' : 'Voice transcription failed.');
        } finally {
          setIsTranscribingMic(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setErrorMsg(null);
    } catch {
      setErrorMsg(
        language === 'ar'
          ? 'يرجى السماح بالوصول إلى الميكروفون.'
          : 'Please allow microphone access.'
      );
    }
  };

  const sendMessage = async (
    overrideText?: string,
    overrideSearch?: boolean
  ) => {
    const promptText = (overrideText ?? input).trim();
    if ((!promptText && !attachment) || isStreaming) return;

    const activeSearch = overrideSearch ?? useSearch;
    const hasUrl = /https?:\/\/\S+/i.test(promptText);
    const activeUrlContext = useUrlContext || hasUrl;

    const userMsg: ChatMessage = {
      id: generateId('msg'),
      role: 'user',
      content: promptText || (language === 'ar' ? 'حلّل هذا الملف المرفق.' : 'Analyze this attached file.'),
      createdAt: Date.now(),
      attachmentSummary: attachment ? `${attachment.name} (${Math.round(attachment.sizeBytes / 1024)} KB)` : undefined,
    };

    const nextMessages = [...conversation.messages, userMsg];
    const nextTitle =
      conversation.messages.length === 0
        ? userMsg.content.slice(0, 60)
        : conversation.title;

    const updatedConv: Conversation = {
      ...conversation,
      title: nextTitle,
      persona,
      lastMessagePreview: userMsg.content.slice(0, 120),
      messageCount: nextMessages.length,
      updatedAt: Date.now(),
      messages: nextMessages,
    };

    onUpdateConversation(updatedConv, [userMsg]);

    if (!overrideText) setInput('');
    const currentAttachment = attachment;
    setAttachment(null);
    setErrorMsg(null);
    setIsStreaming(true);
    setStreamingContent('');

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulated = '';
    let collectedSources: GroundingSource[] = [];

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          systemInstruction: PERSONA_INSTRUCTIONS[persona][language],
          thinkingLevel,
          useSearch: activeSearch,
          useUrlContext: activeUrlContext,
          attachment: currentAttachment
            ? {
                name: currentAttachment.name,
                mimeType: currentAttachment.mimeType,
                data: currentAttachment.data,
              }
            : null,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
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
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.type === 'chunk' && parsed.text) {
              accumulated += parsed.text;
              setStreamingContent(accumulated);
            } else if (parsed.type === 'sources' && Array.isArray(parsed.sources)) {
              collectedSources = parsed.sources;
            } else if (parsed.type === 'error') {
              setErrorMsg(language === 'ar' ? parsed.messageAr : parsed.messageEn);
            }
          } catch {
            // Skip malformed chunk
          }
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        setErrorMsg(
          language === 'ar'
            ? 'تعذر الاتصال بخدمة الذكاء الاصطناعي.'
            : 'Unable to reach AI service.'
        );
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      if (accumulated.trim()) {
        const assistantMsg: ChatMessage = {
          id: generateId('msg'),
          role: 'assistant',
          content: accumulated,
          createdAt: Date.now(),
          thinkingLevel,
          sources: collectedSources.length > 0 ? collectedSources : undefined,
        };
        const finalMessages = [...nextMessages, assistantMsg];
        onUpdateConversation(
          {
            ...updatedConv,
            lastMessagePreview: accumulated.slice(0, 120),
            messageCount: finalMessages.length,
            updatedAt: Date.now(),
            messages: finalMessages,
          },
          [assistantMsg]
        );
      }
      setStreamingContent('');
    }
  };

  const handleStopStream = () => {
    abortRef.current?.abort();
  };

  const handleCopyMessage = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // ignore
    }
  };

  const handleReadAloud = async (id: string, text: string) => {
    if (ttsPlayingId === id && audioRef.current) {
      audioRef.current.pause();
      setTtsPlayingId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    setTtsLoadingId(id);
    setTtsPlayingId(null);

    try {
      const plain = text.replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>_]/g, '').trim();
      const resp = await fetch('/api/audio/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'single',
          text: plain.slice(0, 2500),
          voiceName: 'Kore',
          style: 'Clear, natural, expressive narrator',
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.audioBase64) {
        setErrorMsg(data.error || 'TTS failed');
        return;
      }
      const audio = new Audio(`data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => setTtsPlayingId(null);
      audio.onerror = () => setTtsPlayingId(null);
      await audio.play();
      setTtsPlayingId(id);
    } catch {
      setErrorMsg(language === 'ar' ? 'تعذر تشغيل القراءة الصوتية.' : 'Audio playback failed.');
    } finally {
      setTtsLoadingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Incognito Notice */}
      {incognito && (
        <div className="px-4 py-2 text-xs text-center border-b border-[var(--border-subtle)] bg-[var(--warning-soft)] text-[var(--warning)]">
          {t.ephemeralBanner}
        </div>
      )}

      {/* Workspace Sub-toolbar */}
      <div className="px-4 sm:px-6 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Persona Selector */}
          <label className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span className="whitespace-nowrap">{t.personaLabel}:</span>
            <select
              value={persona}
              onChange={(e) => setPersona(e.target.value as PersonaId)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            >
              {Object.entries(t.personas).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {/* Thinking Depth Selector */}
          <label className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span className="whitespace-nowrap">{t.thinkingLabel}:</span>
            <select
              value={thinkingLevel}
              onChange={(e) => setThinkingLevel(e.target.value as ThinkingDepth)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            >
              {Object.entries(t.thinkingLevels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {/* Web Search Toggle */}
          <button
            type="button"
            onClick={() => setUseSearch((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
              useSearch
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span>{t.webSearch}</span>
          </button>

          {/* URL Context Toggle */}
          <button
            type="button"
            onClick={() => setUseUrlContext((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
              useUrlContext
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Link2 className="w-3.5 h-3.5 shrink-0" />
            <span>{t.urlContext}</span>
          </button>
        </div>

        {conversation.messages.length > 0 && (
          <button
            type="button"
            onClick={() => exportConversationMarkdown(conversation)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>{t.exportMarkdown}</span>
          </button>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {conversation.messages.length === 0 && !isStreaming ? (
            <div className="py-10 space-y-8">
              <div className="space-y-2.5 max-w-2xl">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)] [text-wrap:balance]">
                  {t.chatWelcomeTitle}
                </h1>
                <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
                  {t.chatWelcomeSubtitle}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {t.starterPrompts.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => sendMessage(item.prompt, Boolean((item as { search?: boolean }).search))}
                    className="text-start p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)] transition-colors space-y-1.5"
                  >
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {item.title}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">
                      {item.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {conversation.messages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[90%] sm:max-w-[82%] rounded-xl px-4 py-3.5 border ${
                        isUser
                          ? 'bg-[var(--bg-elevated)] border-[var(--border-strong)] text-[var(--text-primary)]'
                          : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-primary)] w-full'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4 mb-1.5 text-[11px] text-[var(--text-muted)] tabular-nums">
                        <span className="font-medium">
                          {isUser
                            ? language === 'ar'
                              ? 'أنت'
                              : 'You'
                            : t.brand}
                          {msg.thinkingLevel && !isUser && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span>{t.thinkingLevels[msg.thinkingLevel]}</span>
                            </>
                          )}
                        </span>
                        <span>
                          {new Date(msg.createdAt).toLocaleTimeString(
                            language === 'ar' ? 'ar-EG' : 'en-US',
                            { hour: '2-digit', minute: '2-digit' }
                          )}
                        </span>
                      </div>

                      {msg.attachmentSummary && (
                        <div className="mb-2 text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
                          <Paperclip className="w-3.5 h-3.5 shrink-0" />
                          <span>{msg.attachmentSummary}</span>
                        </div>
                      )}

                      {isUser ? (
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">
                          {msg.content}
                        </p>
                      ) : (
                        <MarkdownRenderer content={msg.content} language={language} />
                      )}

                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] space-y-2">
                          <p className="text-xs font-medium text-[var(--text-muted)]">
                            {t.sourcesTitle}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {msg.sources.map((src, i) => (
                              <a
                                key={i}
                                href={src.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors max-w-[260px]"
                              >
                                <ExternalLink className="w-3 h-3 shrink-0" />
                                <span className="truncate">{src.title}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {!isUser && (
                        <div className="mt-3 pt-2.5 border-t border-[var(--border-subtle)] flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(msg.id, msg.content)}
                            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
                          >
                            {copiedId === msg.id ? (
                              <Check className="w-3.5 h-3.5 text-[var(--success)]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedId === msg.id ? t.copied : t.copy}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReadAloud(msg.id, msg.content)}
                            disabled={ttsLoadingId === msg.id}
                            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors whitespace-nowrap"
                          >
                            {ttsPlayingId === msg.id ? (
                              <Square className="w-3.5 h-3.5 text-[var(--accent)]" />
                            ) : (
                              <Volume2 className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {ttsLoadingId === msg.id
                                ? t.loadingAudio
                                : ttsPlayingId === msg.id
                                ? t.stopAudio
                                : t.listen}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {isStreaming && (
                <div className="flex flex-col items-start">
                  <div className="w-full max-w-[90%] sm:max-w-[82%] rounded-xl px-4 py-3.5 border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="text-[11px] text-[var(--text-muted)] mb-1.5 font-medium">
                      {t.brand}
                    </div>
                    {streamingContent ? (
                      <MarkdownRenderer content={streamingContent} language={language} />
                    ) : (
                      <div className="space-y-2 py-1">
                        <div className="h-3.5 w-3/4 rounded bg-[var(--bg-elevated)] animate-pulse" />
                        <div className="h-3.5 w-1/2 rounded bg-[var(--bg-elevated)] animate-pulse" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {errorMsg && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="p-3.5 sm:p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="max-w-4xl mx-auto space-y-2">
          {attachment && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs text-[var(--text-primary)]">
              <Paperclip className="w-3.5 h-3.5 shrink-0 text-[var(--accent)]" />
              <span className="truncate max-w-[240px]">{attachment.name}</span>
              <span className="text-[var(--text-muted)] tabular-nums">
                {Math.round(attachment.sizeBytes / 1024)} KB
              </span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                aria-label="Remove attachment"
                className="text-[var(--text-muted)] hover:text-[var(--danger)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-2 focus-within:border-[var(--accent)] transition-colors">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title={t.attachFile}
              className="p-2.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors shrink-0"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf,text/*,.md,.json,.csv,.ts,.tsx,.js,.py"
              className="hidden"
              onChange={handleAttachFile}
            />

            <button
              type="button"
              onClick={toggleMicRecording}
              disabled={isTranscribingMic}
              title={isRecording ? t.recordingStop : t.voiceInput}
              className={`p-2.5 rounded-lg transition-colors shrink-0 ${
                isRecording
                  ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Mic className="w-4 h-4" />
            </button>

            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={
                isTranscribingMic
                  ? t.transcribing
                  : t.chatPlaceholder
              }
              className="flex-1 resize-none bg-transparent py-2 px-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none max-h-40 overflow-y-auto"
            />

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStopStream}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-[var(--danger-soft)] text-[var(--danger)] border border-[var(--danger)] transition-colors whitespace-nowrap shrink-0"
              >
                <Square className="w-3.5 h-3.5" />
                <span>{t.stop}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => sendMessage()}
                disabled={!input.trim() && !attachment}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{t.send}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
