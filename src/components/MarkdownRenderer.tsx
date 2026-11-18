import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { Language } from '../types';

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
  language: Language;
}

function CodeBlock({ className, children, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const codeText = String(children ?? '').replace(/\n$/, '');
  const isInline = !match && !codeText.includes('\n');

  if (isInline) {
    return <code className={className}>{children}</code>;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div className="my-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] overflow-hidden" dir="ltr">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs text-[var(--text-muted)]">
        <span className="font-mono">{match?.[1] || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? (language === 'ar' ? 'تم النسخ' : 'Copied') : language === 'ar' ? 'نسخ' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-[13px] leading-relaxed font-mono text-[var(--text-primary)]">
        <code>{codeText}</code>
      </pre>
    </div>
  );
}

interface MarkdownRendererProps {
  content: string;
  language: Language;
}

export function MarkdownRenderer({ content, language }: MarkdownRendererProps) {
  return (
    <div className="prose-ai break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            return <CodeBlock className={props.className} language={language}>{props.children}</CodeBlock>;
          },
          a(props) {
            return (
              <a
                href={props.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                {props.children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
