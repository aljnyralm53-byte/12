import React, { useState } from 'react';
import {
  AlertCircle,
  Code2,
  Download,
  Eye,
  Layers,
  Palette,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { UI_TEXT } from '../i18n';
import { generateId } from '../storage';
import { Language, VectorDesign } from '../types';

interface CanvasWorkspaceProps {
  language: Language;
  designs: VectorDesign[];
  onSaveDesign: (design: VectorDesign) => void;
  onDeleteDesign: (id: string) => void;
}

type DesignStyle = 'illustration' | 'diagram' | 'icon' | 'infographic' | 'ui-mockup';
type RatioOption = '1:1' | '16:9' | '4:3' | '3:4';

export function CanvasWorkspace({
  language,
  designs,
  onSaveDesign,
  onDeleteDesign,
}: CanvasWorkspaceProps) {
  const t = UI_TEXT[language];
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<DesignStyle>('illustration');
  const [aspectRatio, setAspectRatio] = useState<RatioOption>('1:1');
  const [refineMode, setRefineMode] = useState(false);
  const [activeDesign, setActiveDesign] = useState<VectorDesign | null>(designs[0] || null);
  const [showCode, setShowCode] = useState(false);
  const [backdrop, setBackdrop] = useState<'dark' | 'light' | 'grid'>('grid');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setErrorMsg(null);

    try {
      const resp = await fetch('/api/canvas/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          style,
          aspectRatio,
          previousSvg: refineMode && activeDesign ? activeDesign.svgCode : '',
          language,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErrorMsg(language === 'ar' ? data.error : data.errorEn || data.error);
        return;
      }

      const created: VectorDesign = {
        id: generateId('svg'),
        title: data.title || prompt.slice(0, 60),
        prompt: prompt.trim(),
        svgCode: data.svgCode,
        aspectRatio,
        palette: Array.isArray(data.palette) ? data.palette : [],
        createdAt: Date.now(),
      };
      setActiveDesign(created);
      onSaveDesign(created);
      setShowCode(false);
    } catch {
      setErrorMsg(
        language === 'ar' ? 'تعذر إنشاء التصميم المتجه.' : 'Failed to generate vector design.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadSvg = () => {
    if (!activeDesign) return;
    const blob = new Blob([activeDesign.svgCode], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeDesign.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'design'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPng = () => {
    if (!activeDesign) return;
    const svgBlob = new Blob([activeDesign.svgCode], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height =
        activeDesign.aspectRatio === '16:9'
          ? 900
          : activeDesign.aspectRatio === '4:3'
          ? 1200
          : activeDesign.aspectRatio === '3:4'
          ? 2133
          : 1600;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `${activeDesign.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'design'}.png`;
        a.click();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">{t.canvasTitle}</h1>
          <p className="text-sm text-[var(--text-secondary)]">{t.canvasSubtitle}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Controls Column */}
          <div className="lg:col-span-4 flex flex-col gap-4 p-4 sm:p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t.canvasPromptPlaceholder}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none"
            />

            {/* Design Style */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-[var(--text-muted)]">
                {language === 'ar' ? 'نوع التصميم' : 'Style'}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(t.designStyles).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStyle(key as DesignStyle)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                      style === key
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect Ratio */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-[var(--text-muted)]">{t.aspectRatio}</span>
              <div className="grid grid-cols-4 gap-1.5">
                {(['1:1', '16:9', '4:3', '3:4'] as const).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setAspectRatio(ratio)}
                    className={`py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                      aspectRatio === ratio
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            {activeDesign && (
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={refineMode}
                  onChange={(e) => setRefineMode(e.target.checked)}
                  className="rounded border-[var(--border-strong)] accent-[var(--accent)]"
                />
                <RefreshCw className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>{t.refineToggle}</span>
              </label>
            )}

            <button
              type="button"
              disabled={!prompt.trim() || isGenerating}
              onClick={handleGenerate}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              <Palette className="w-4 h-4 shrink-0" />
              <span>{isGenerating ? t.generatingDesign : t.generateDesign}</span>
            </button>

            {errorMsg && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)] text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Canvas Viewport */}
          <div className="lg:col-span-8 flex flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] min-h-[440px]">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                  {activeDesign?.title || t.canvasTitle}
                </p>
              </div>
              {activeDesign && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setBackdrop((b) => (b === 'grid' ? 'light' : b === 'light' ? 'dark' : 'grid'))
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] whitespace-nowrap"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>{t.canvasBgToggle}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCode((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] whitespace-nowrap"
                  >
                    {showCode ? <Eye className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />}
                    <span>{showCode ? t.viewPreview : t.viewCode}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadSvg}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{t.downloadSvg}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPng}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)] whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{t.downloadPng}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 p-5 flex items-center justify-center overflow-auto">
              {isGenerating ? (
                <div className="w-full max-w-md aspect-square rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] animate-pulse" />
              ) : activeDesign ? (
                showCode ? (
                  <pre
                    dir="ltr"
                    className="w-full h-full max-h-[420px] overflow-auto p-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-mono text-[var(--text-primary)]"
                  >
                    {activeDesign.svgCode}
                  </pre>
                ) : (
                  <div
                    className={`w-full max-w-xl rounded-xl border border-[var(--border-subtle)] p-4 flex items-center justify-center overflow-hidden ${
                      backdrop === 'light'
                        ? 'bg-white'
                        : backdrop === 'dark'
                        ? 'bg-[#090D16]'
                        : 'bg-[var(--bg-canvas)] futuristic-grid'
                    }`}
                    dangerouslySetInnerHTML={{ __html: activeDesign.svgCode }}
                  />
                )
              ) : (
                <div className="text-center py-12 px-4">
                  <Palette className="w-10 h-10 mx-auto mb-3 text-[var(--text-muted)] opacity-60" />
                  <p className="text-sm text-[var(--text-secondary)]">{t.noDesigns}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Saved Designs Gallery */}
        {designs.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t.savedDesigns}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
              {designs.map((d) => (
                <div
                  key={d.id}
                  onClick={() => {
                    setActiveDesign(d);
                    setShowCode(false);
                  }}
                  className={`group rounded-xl border p-3 cursor-pointer transition-colors bg-[var(--bg-surface)] ${
                    activeDesign?.id === d.id
                      ? 'border-[var(--accent)]'
                      : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <div
                    className="aspect-video rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2 flex items-center justify-center overflow-hidden mb-2.5 [&>svg]:max-h-full [&>svg]:w-auto"
                    dangerouslySetInnerHTML={{ __html: d.svgCode }}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {d.title}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)] font-mono">
                        {d.aspectRatio}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteDesign(d.id);
                        if (activeDesign?.id === d.id) setActiveDesign(null);
                      }}
                      aria-label="Delete design"
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
