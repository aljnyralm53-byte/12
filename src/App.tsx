import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  Cpu,
  FileSearch,
  Globe,
  Menu,
  MessageSquare,
  Moon,
  Palette,
  Sun,
  Volume2,
} from 'lucide-react';
import { AudioWorkspace } from './components/AudioWorkspace';
import { CanvasWorkspace } from './components/CanvasWorkspace';
import { ChatWorkspace } from './components/ChatWorkspace';
import { DocsWorkspace } from './components/DocsWorkspace';
import { Sidebar } from './components/Sidebar';
import {
  auth,
  deleteCloudConversation,
  deleteCloudDesign,
  fetchCloudConversations,
  fetchCloudDesigns,
  loadUserProfilePreferences,
  saveCloudDesign,
  signInWithGoogle,
  signOutGoogle,
  syncConversationToCloud,
  testConnection,
  upsertUserProfile,
} from './firebase';
import { UI_TEXT } from './i18n';
import {
  exportConversationsJson,
  generateId,
  loadLocalConversations,
  loadLocalDesigns,
  loadPreferences,
  saveLocalConversations,
  saveLocalDesigns,
  savePreferences,
} from './storage';
import {
  ChatMessage,
  Conversation,
  Language,
  ThemeMode,
  UserPreferences,
  VectorDesign,
  WorkspaceMode,
} from './types';

function createEmptyConversation(
  language: Language,
  mode: WorkspaceMode = 'chat'
): Conversation {
  return {
    id: generateId('conv'),
    title: language === 'ar' ? 'جلسة جديدة' : 'New Session',
    mode,
    persona: 'general',
    lastMessagePreview: '',
    messageCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

export default function App() {
  const [prefs, setPrefs] = useState<UserPreferences>(() => loadPreferences());
  const [workspace, setWorkspace] = useState<WorkspaceMode>('chat');
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    loadLocalConversations()
  );
  const [activeConv, setActiveConv] = useState<Conversation>(() =>
    createEmptyConversation(loadPreferences().language, 'chat')
  );
  const [designs, setDesigns] = useState<VectorDesign[]>(() => loadLocalDesigns());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cloudError, setCloudError] = useState<string | null>(null);

  const t = UI_TEXT[prefs.language];

  // Apply RTL/LTR and Theme tokens on <html>
  useEffect(() => {
    const root = document.documentElement;
    root.lang = prefs.language;
    root.dir = prefs.language === 'ar' ? 'rtl' : 'ltr';

    root.classList.remove('dark', 'theme-dark', 'theme-light', 'theme-futuristic');
    if (prefs.theme === 'light') {
      root.classList.add('theme-light');
    } else if (prefs.theme === 'futuristic') {
      root.classList.add('dark', 'theme-futuristic');
    } else {
      root.classList.add('dark', 'theme-dark');
    }

    savePreferences(prefs);
  }, [prefs]);

  // Startup Firestore connectivity test & Auth listener
  useEffect(() => {
    testConnection();
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        try {
          const remotePrefs = await loadUserProfilePreferences(currentUser.uid);
          if (remotePrefs?.preferredLanguage || remotePrefs?.preferredTheme) {
            setPrefs((prev) => ({
              ...prev,
              language: remotePrefs.preferredLanguage || prev.language,
              theme: remotePrefs.preferredTheme || prev.theme,
            }));
          }
          await upsertUserProfile(
            currentUser,
            remotePrefs?.preferredLanguage || prefs.language,
            remotePrefs?.preferredTheme || prefs.theme
          );
          const [cloudConvs, cloudDesigns] = await Promise.all([
            fetchCloudConversations(currentUser.uid),
            fetchCloudDesigns(currentUser.uid),
          ]);
          if (cloudConvs.length > 0) {
            setConversations((prev) => {
              const map = new Map<string, Conversation>();
              for (const c of prev) map.set(c.id, c);
              for (const c of cloudConvs) map.set(c.id, c);
              return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
            });
          }
          if (cloudDesigns.length > 0) {
            setDesigns((prev) => {
              const map = new Map<string, VectorDesign>();
              for (const d of prev) map.set(d.id, d);
              for (const d of cloudDesigns) map.set(d.id, d);
              return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
            });
          }
          setCloudError(null);
        } catch (err) {
          console.error('Cloud sync initialization warning:', err);
        }
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpdatePrefs = useCallback(
    async (patch: Partial<UserPreferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        if (user && (patch.language || patch.theme)) {
          upsertUserProfile(user, next.language, next.theme).catch(() => {});
        }
        return next;
      });
    },
    [user]
  );

  const handleNewSession = () => {
    setActiveConv(createEmptyConversation(prefs.language, 'chat'));
    setWorkspace('chat');
  };

  const handleUpdateConversation = useCallback(
    (updated: Conversation, newMessagesToSync?: ChatMessage[]) => {
      setActiveConv(updated);
      if (prefs.incognito) return;

      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        const next =
          idx >= 0
            ? prev.map((c) => (c.id === updated.id ? updated : c))
            : [updated, ...prev];
        const sorted = next.sort((a, b) => b.updatedAt - a.updatedAt);
        saveLocalConversations(sorted);
        return sorted;
      });

      if (user && newMessagesToSync && newMessagesToSync.length > 0) {
        syncConversationToCloud(user.uid, updated, newMessagesToSync).catch((err) => {
          console.error('Cloud conversation sync failed:', err);
        });
      }
    },
    [prefs.incognito, user]
  );

  const handleDeleteConversation = async (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveLocalConversations(next);
      return next;
    });
    if (activeConv.id === id) {
      setActiveConv(createEmptyConversation(prefs.language, 'chat'));
    }
    if (user) {
      deleteCloudConversation(user.uid, id).catch(() => {});
    }
  };

  const handleImportJson = (imported: Conversation[]) => {
    setConversations((prev) => {
      const map = new Map<string, Conversation>();
      for (const c of prev) map.set(c.id, c);
      for (const c of imported) map.set(c.id, c);
      const merged = Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
      saveLocalConversations(merged);
      return merged;
    });
  };

  const handleSaveDocSession = (
    title: string,
    prompt: string,
    result: string,
    attachmentSummary: string
  ) => {
    if (prefs.incognito) return;
    const convId = generateId('doc');
    const userMsg: ChatMessage = {
      id: generateId('msg'),
      role: 'user',
      content: prompt,
      createdAt: Date.now(),
      attachmentSummary: attachmentSummary || undefined,
    };
    const assistantMsg: ChatMessage = {
      id: generateId('msg'),
      role: 'assistant',
      content: result,
      createdAt: Date.now() + 1,
    };
    const docConv: Conversation = {
      id: convId,
      title: title.slice(0, 80),
      mode: 'docs',
      persona: 'researcher',
      lastMessagePreview: result.slice(0, 120),
      messageCount: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [userMsg, assistantMsg],
    };

    setConversations((prev) => {
      const next = [docConv, ...prev];
      saveLocalConversations(next);
      return next;
    });

    if (user) {
      syncConversationToCloud(user.uid, docConv, [userMsg, assistantMsg]).catch(() => {});
    }
  };

  const handleContinueInChat = (seedPrompt: string, analysisResult: string) => {
    const userMsg: ChatMessage = {
      id: generateId('msg'),
      role: 'user',
      content: seedPrompt || (prefs.language === 'ar' ? 'تحليل مستند' : 'Document analysis'),
      createdAt: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: generateId('msg'),
      role: 'assistant',
      content: analysisResult,
      createdAt: Date.now() + 1,
    };
    const conv: Conversation = {
      id: generateId('conv'),
      title: seedPrompt.slice(0, 60) || (prefs.language === 'ar' ? 'متابعة التحليل' : 'Follow-up Chat'),
      mode: 'chat',
      persona: 'researcher',
      lastMessagePreview: analysisResult.slice(0, 120),
      messageCount: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [userMsg, assistantMsg],
    };
    handleUpdateConversation(conv, [userMsg, assistantMsg]);
    setWorkspace('chat');
  };

  const handleSendTranscriptToChat = (transcriptText: string) => {
    const userMsg: ChatMessage = {
      id: generateId('msg'),
      role: 'user',
      content: transcriptText,
      createdAt: Date.now(),
    };
    const conv: Conversation = {
      id: generateId('conv'),
      title: transcriptText.slice(0, 60),
      mode: 'chat',
      persona: 'general',
      lastMessagePreview: transcriptText.slice(0, 120),
      messageCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [userMsg],
    };
    handleUpdateConversation(conv, [userMsg]);
    setWorkspace('chat');
  };

  const handleSaveDesign = (design: VectorDesign) => {
    if (prefs.incognito) return;
    setDesigns((prev) => {
      const next = [design, ...prev];
      saveLocalDesigns(next);
      return next;
    });
    if (user) {
      saveCloudDesign(user.uid, design).catch(() => {});
    }
  };

  const handleDeleteDesign = (id: string) => {
    setDesigns((prev) => {
      const next = prev.filter((d) => d.id !== id);
      saveLocalDesigns(next);
      return next;
    });
    if (user) {
      deleteCloudDesign(user.uid, id).catch(() => {});
    }
  };

  const handleSignIn = async () => {
    try {
      setCloudError(null);
      await signInWithGoogle();
    } catch {
      setCloudError(
        prefs.language === 'ar'
          ? 'تعذر تسجيل الدخول بحساب Google.'
          : 'Google sign-in was cancelled or failed.'
      );
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutGoogle();
    } catch {
      // ignore
    }
  };

  const navItems: Array<{ id: WorkspaceMode; label: string; icon: React.ReactNode }> = [
    { id: 'chat', label: t.navChat, icon: <MessageSquare className="w-4 h-4 shrink-0" /> },
    { id: 'docs', label: t.navDocs, icon: <FileSearch className="w-4 h-4 shrink-0" /> },
    { id: 'canvas', label: t.navCanvas, icon: <Palette className="w-4 h-4 shrink-0" /> },
    { id: 'audio', label: t.navAudio, icon: <Volume2 className="w-4 h-4 shrink-0" /> },
  ];

  const themeOptions: Array<{ id: ThemeMode; label: string; icon: React.ReactNode }> = [
    { id: 'dark', label: t.themeDark, icon: <Moon className="w-3.5 h-3.5" /> },
    { id: 'light', label: t.themeLight, icon: <Sun className="w-3.5 h-3.5" /> },
    { id: 'futuristic', label: t.themeFuturistic, icon: <Cpu className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <Sidebar
        language={prefs.language}
        conversations={conversations}
        activeConversationId={activeConv.id}
        incognito={prefs.incognito}
        user={user}
        authLoading={authLoading}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onNewSession={handleNewSession}
        onSelectConversation={(conv) => {
          setActiveConv(conv);
          setWorkspace('chat');
        }}
        onDeleteConversation={handleDeleteConversation}
        onToggleIncognito={() => handleUpdatePrefs({ incognito: !prefs.incognito })}
        onExportJson={() => exportConversationsJson(conversations)}
        onImportJson={handleImportJson}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Top Bar Contract: Zone 1 Brand | Zone 2 Nav Links | Zone 3 Controls */}
        <header className="h-14 shrink-0 px-4 sm:px-6 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between gap-4">
          {/* Zone 1: Brand Wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="text-base sm:text-lg font-bold tracking-tight text-[var(--text-primary)] whitespace-nowrap shrink-0">
              {t.brand}
            </span>
          </div>

          {/* Zone 2: Workspace Navigation */}
          <nav className="hidden md:flex items-center gap-1 lg:gap-2">
            {navItems.map((item) => {
              const active = workspace === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setWorkspace(item.id)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs lg:text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Theme Switcher & Language Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:inline-flex items-center p-0.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
              {themeOptions.map((opt) => {
                const active = prefs.theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleUpdatePrefs({ theme: opt.id })}
                    title={opt.label}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {opt.icon}
                    <span className="hidden xl:inline">{opt.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                const order: ThemeMode[] = ['dark', 'light', 'futuristic'];
                const next = order[(order.indexOf(prefs.theme) + 1) % order.length];
                handleUpdatePrefs({ theme: next });
              }}
              aria-label="Switch theme"
              className="sm:hidden p-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)]"
            >
              {prefs.theme === 'light' ? (
                <Sun className="w-4 h-4" />
              ) : prefs.theme === 'futuristic' ? (
                <Cpu className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() =>
                handleUpdatePrefs({ language: prefs.language === 'ar' ? 'en' : 'ar' })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors whitespace-nowrap shrink-0"
            >
              <Globe className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
              <span>{t.langSwitch}</span>
            </button>
          </div>
        </header>

        {/* Mobile Workspace Navigation Strip */}
        <div className="md:hidden shrink-0 px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center gap-1.5 overflow-x-auto">
          {navItems.map((item) => {
            const active = workspace === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setWorkspace(item.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-[var(--text-secondary)] bg-[var(--bg-canvas)]'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {cloudError && (
          <div className="px-4 py-2 text-xs text-center bg-[var(--danger-soft)] text-[var(--danger)] border-b border-[var(--border-subtle)]">
            {cloudError}
          </div>
        )}

        {/* Active Workspace Viewport */}
        <main className="flex-1 min-h-0 futuristic-grid">
          {workspace === 'chat' && (
            <ChatWorkspace
              language={prefs.language}
              conversation={activeConv}
              incognito={prefs.incognito}
              onUpdateConversation={handleUpdateConversation}
            />
          )}
          {workspace === 'docs' && (
            <DocsWorkspace
              language={prefs.language}
              onSaveToSession={handleSaveDocSession}
              onContinueInChat={handleContinueInChat}
            />
          )}
          {workspace === 'canvas' && (
            <CanvasWorkspace
              language={prefs.language}
              designs={designs}
              onSaveDesign={handleSaveDesign}
              onDeleteDesign={handleDeleteDesign}
            />
          )}
          {workspace === 'audio' && (
            <AudioWorkspace
              language={prefs.language}
              onSendTranscriptToChat={handleSendTranscriptToChat}
            />
          )}
        </main>
      </div>
    </div>
  );
}
