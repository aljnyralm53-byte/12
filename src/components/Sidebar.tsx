import React, { useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Cloud,
  Download,
  EyeOff,
  FileText,
  HardDrive,
  LogIn,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { UI_TEXT } from '../i18n';
import { Conversation, Language } from '../types';

interface SidebarProps {
  language: Language;
  conversations: Conversation[];
  activeConversationId: string | null;
  incognito: boolean;
  user: User | null;
  authLoading: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onNewSession: () => void;
  onSelectConversation: (conv: Conversation) => void;
  onDeleteConversation: (id: string) => void;
  onToggleIncognito: () => void;
  onExportJson: () => void;
  onImportJson: (convs: Conversation[]) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function Sidebar({
  language,
  conversations,
  activeConversationId,
  incognito,
  user,
  authLoading,
  mobileOpen,
  onCloseMobile,
  onNewSession,
  onSelectConversation,
  onDeleteConversation,
  onToggleIncognito,
  onExportJson,
  onImportJson,
  onSignIn,
  onSignOut,
}: SidebarProps) {
  const t = UI_TEXT[language];
  const [searchQuery, setSearchQuery] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | 'chat' | 'docs'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter((c) => {
      if (modeFilter !== 'all' && c.mode !== modeFilter) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.lastMessagePreview.toLowerCase().includes(q)
      );
    });
  }, [conversations, searchQuery, modeFilter]);

  const formatTime = (ms: number) => {
    try {
      return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-US', {
        month: 'short',
        day: 'numeric',
      }).format(new Date(ms));
    } catch {
      return '';
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((item) => item && item.id && Array.isArray(item.messages));
        onImportJson(valid);
      }
    } catch {
      // Invalid JSON ignored gracefully
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const sidebarContent = (
    <aside className="w-[272px] h-full flex flex-col border-e border-[var(--border-subtle)] bg-[var(--bg-surface)] select-none">
      {/* Top Action Row */}
      <div className="p-3.5 space-y-2.5 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onNewSession();
              onCloseMobile();
            }}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg text-sm font-medium bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>{t.newSession}</span>
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close sidebar"
            className="lg:hidden p-2.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Persistence / Ephemeral Toggle */}
        <button
          type="button"
          onClick={onToggleIncognito}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
            incognito
              ? 'border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <span className="inline-flex items-center gap-2 truncate">
            <EyeOff className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{incognito ? t.incognitoOn : t.incognitoOff}</span>
          </span>
        </button>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.searchHistory}
            className="w-full ps-8 pe-3 py-1.5 rounded-lg text-xs bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        {/* Mode Segmented Filter */}
        <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
          {(['all', 'chat', 'docs'] as const).map((f) => {
            const label = f === 'all' ? t.filterAll : f === 'chat' ? t.filterChat : t.filterDocs;
            const active = modeFilter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setModeFilter(f)}
                className={`py-1 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredConversations.length === 0 ? (
          <div className="px-3 py-8 text-center space-y-1.5">
            <p className="text-xs font-medium text-[var(--text-secondary)]">{t.noSessions}</p>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{t.noSessionsHint}</p>
          </div>
        ) : (
          filteredConversations.map((conv) => {
            const isActive = conv.id === activeConversationId;
            return (
              <div
                key={conv.id}
                className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[var(--accent-soft)] text-[var(--text-primary)]'
                    : 'hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                }`}
                onClick={() => {
                  onSelectConversation(conv);
                  onCloseMobile();
                }}
              >
                <div className="min-w-0 flex-1 flex items-start gap-2.5">
                  {conv.mode === 'docs' ? (
                    <FileText className="w-4 h-4 mt-0.5 shrink-0 text-[var(--text-muted)]" />
                  ) : (
                    <MessageSquare className="w-4 h-4 mt-0.5 shrink-0 text-[var(--text-muted)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {conv.title}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 tabular-nums truncate mt-0.5">
                      <span>{conv.mode === 'docs' ? t.filterDocs : t.filterChat}</span>
                      <span aria-hidden="true">·</span>
                      <span>{conv.messages.length}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatTime(conv.updatedAt)}</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(conv.id);
                  }}
                  aria-label="Delete conversation"
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Footer: Backup & Cloud Sync Account */}
      <div className="p-3 border-t border-[var(--border-subtle)] space-y-2.5 bg-[var(--bg-surface)]">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onExportJson}
            disabled={conversations.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>{t.exportJson}</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span>{t.importJson}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>

        {user ? (
          <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
            <div className="min-w-0 flex items-center gap-2">
              <Cloud className="w-4 h-4 shrink-0 text-[var(--success)]" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                  {user.displayName || user.email}
                </p>
                <p className="text-[11px] text-[var(--text-muted)] truncate">{t.cloudSynced}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              title={t.signOut}
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={onSignIn}
              disabled={authLoading}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" />
              <span>{t.signInGoogle}</span>
            </button>
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--text-muted)]">
              <HardDrive className="w-3 h-3 shrink-0" />
              <span>{t.localOnly}</span>
            </p>
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block h-full shrink-0">{sidebarContent}</div>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
