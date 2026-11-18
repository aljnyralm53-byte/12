import { Conversation, UserPreferences, VectorDesign } from './types';

const PREFS_KEY = 'nuha_ai_prefs_v1';
const CONVERSATIONS_KEY = 'nuha_ai_conversations_v1';
const DESIGNS_KEY = 'nuha_ai_designs_v1';

export function generateId(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) {
      return { language: 'ar', theme: 'dark', incognito: false };
    }
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      language: parsed.language === 'en' ? 'en' : 'ar',
      theme:
        parsed.theme === 'light' || parsed.theme === 'futuristic' ? parsed.theme : 'dark',
      incognito: Boolean(parsed.incognito),
    };
  } catch {
    return { language: 'ar', theme: 'dark', incognito: false };
  }
}

export function savePreferences(prefs: UserPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLocalConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalConversations(conversations: Conversation[]): void {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations.slice(0, 80)));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLocalDesigns(): VectorDesign[] {
  try {
    const raw = localStorage.getItem(DESIGNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalDesigns(designs: VectorDesign[]): void {
  try {
    localStorage.setItem(DESIGNS_KEY, JSON.stringify(designs.slice(0, 40)));
  } catch {
    // Ignore storage quota errors
  }
}

export function exportConversationsJson(conversations: Conversation[]): void {
  const blob = new Blob([JSON.stringify(conversations, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nuha-ai-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportConversationMarkdown(conv: Conversation): void {
  const lines: string[] = [`# ${conv.title}`, ''];
  for (const msg of conv.messages) {
    lines.push(`## ${msg.role === 'user' ? 'User' : 'Nuha AI'}`);
    if (msg.attachmentSummary) {
      lines.push(`*Attachment: ${msg.attachmentSummary}*`, '');
    }
    lines.push(msg.content, '');
    if (msg.sources?.length) {
      lines.push('**Sources:**');
      for (const s of msg.sources) {
        lines.push(`- [${s.title}](${s.uri})`);
      }
      lines.push('');
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${conv.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 50) || 'chat'}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
