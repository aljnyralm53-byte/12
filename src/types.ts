export type Language = 'ar' | 'en';
export type ThemeMode = 'dark' | 'light' | 'futuristic';
export type WorkspaceMode = 'chat' | 'docs' | 'canvas' | 'audio';
export type ThinkingDepth = 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';
export type PersonaId = 'general' | 'developer' | 'writer' | 'researcher' | 'translator';

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface AttachmentPayload {
  name: string;
  mimeType: string;
  data: string; // base64 without data URL prefix
  sizeBytes: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  thinkingLevel?: ThinkingDepth;
  attachmentSummary?: string;
  sources?: GroundingSource[];
}

export interface Conversation {
  id: string;
  title: string;
  mode: WorkspaceMode;
  persona: PersonaId;
  lastMessagePreview: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface VectorDesign {
  id: string;
  title: string;
  prompt: string;
  svgCode: string;
  aspectRatio: '1:1' | '16:9' | '4:3' | '3:4';
  palette: string[];
  createdAt: number;
}

export interface UserPreferences {
  language: Language;
  theme: ThemeMode;
  incognito: boolean;
}
