import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  getFirestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { ChatMessage, Conversation, Language, ThemeMode, VectorDesign } from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Startup connectivity test
export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration — client appears offline.');
    }
  }
}

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutGoogle(): Promise<void> {
  await signOut(auth);
}

// Safe ID sanitizer matching ^[a-zA-Z0-9_\-]+$
export function toSafeFirestoreId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || `id_${Date.now()}`;
}

export async function upsertUserProfile(
  user: User,
  preferredLanguage: Language,
  preferredTheme: ThemeMode
): Promise<void> {
  const uid = toSafeFirestoreId(user.uid);
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);

  try {
    const snap = await getDoc(ref);
    const displayName = (user.displayName || user.email || 'User').slice(0, 120);
    const email = (user.email || 'user@example.com').slice(0, 200);

    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        displayName,
        email,
        preferredLanguage,
        preferredTheme,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName,
        preferredLanguage,
        preferredTheme,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function loadUserProfilePreferences(
  uid: string
): Promise<{ preferredLanguage?: Language; preferredTheme?: ThemeMode } | null> {
  const safeUid = toSafeFirestoreId(uid);
  const path = `users/${safeUid}`;
  try {
    const snap = await getDoc(doc(db, 'users', safeUid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      preferredLanguage: data.preferredLanguage as Language,
      preferredTheme: data.preferredTheme as ThemeMode,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function fetchCloudConversations(uid: string): Promise<Conversation[]> {
  const safeUid = toSafeFirestoreId(uid);
  const path = `users/${safeUid}/conversations`;
  try {
    const q = query(
      collection(db, 'users', safeUid, 'conversations'),
      where('userId', '==', safeUid),
      orderBy('updatedAt', 'desc')
    );
    const snap = await getDocs(q);
    const conversations: Conversation[] = [];

    for (const d of snap.docs) {
      const data = d.data();
      const convId = toSafeFirestoreId(d.id);
      const msgPath = `users/${safeUid}/conversations/${convId}/messages`;
      let messages: ChatMessage[] = [];
      try {
        const mq = query(
          collection(db, 'users', safeUid, 'conversations', convId, 'messages'),
          where('userId', '==', safeUid),
          where('conversationId', '==', convId),
          orderBy('createdAt', 'asc')
        );
        const mSnap = await getDocs(mq);
        messages = mSnap.docs.map((md) => {
          const m = md.data();
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            thinkingLevel: m.thinkingLevel,
            attachmentSummary: m.attachmentSummary,
            sources: Array.isArray(m.sources) ? m.sources : undefined,
            createdAt: m.createdAt?.toMillis?.() || Date.now(),
          };
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, msgPath);
      }

      conversations.push({
        id: data.id,
        title: data.title,
        mode: data.mode,
        persona: data.persona,
        lastMessagePreview: data.lastMessagePreview || '',
        messageCount: data.messageCount || messages.length,
        createdAt: data.createdAt?.toMillis?.() || Date.now(),
        updatedAt: data.updatedAt?.toMillis?.() || Date.now(),
        messages,
      });
    }
    return conversations;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function syncConversationToCloud(
  uid: string,
  conv: Conversation,
  newMessages: ChatMessage[]
): Promise<void> {
  const safeUid = toSafeFirestoreId(uid);
  const safeConvId = toSafeFirestoreId(conv.id);
  const convPath = `users/${safeUid}/conversations/${safeConvId}`;
  const convRef = doc(db, 'users', safeUid, 'conversations', safeConvId);

  try {
    const existingSnap = await getDoc(convRef);
    const batch = writeBatch(db);

    const payloadBase = {
      title: (conv.title || 'Untitled').slice(0, 200),
      persona: (conv.persona || 'general').slice(0, 60),
      lastMessagePreview: (conv.lastMessagePreview || '').slice(0, 300),
      messageCount: Math.min(conv.messages.length, 5000),
      updatedAt: serverTimestamp(),
    };

    if (!existingSnap.exists()) {
      batch.set(convRef, {
        id: safeConvId,
        userId: safeUid,
        mode: conv.mode,
        ...payloadBase,
        createdAt: serverTimestamp(),
      });
    } else {
      batch.update(convRef, payloadBase);
    }

    for (const msg of newMessages) {
      const safeMsgId = toSafeFirestoreId(msg.id);
      const msgRef = doc(db, 'users', safeUid, 'conversations', safeConvId, 'messages', safeMsgId);
      const msgData: Record<string, unknown> = {
        id: safeMsgId,
        userId: safeUid,
        conversationId: safeConvId,
        role: msg.role,
        content: (msg.content || '...').slice(0, 32000),
        createdAt: serverTimestamp(),
      };
      if (msg.thinkingLevel) {
        msgData.thinkingLevel = msg.thinkingLevel.slice(0, 20);
      }
      if (msg.attachmentSummary) {
        msgData.attachmentSummary = msg.attachmentSummary.slice(0, 300);
      }
      if (Array.isArray(msg.sources) && msg.sources.length > 0) {
        msgData.sources = msg.sources.slice(0, 10).map((s) => ({
          title: String(s.title || '').slice(0, 150),
          uri: String(s.uri || '').slice(0, 500),
        }));
      }
      batch.set(msgRef, msgData);
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, convPath);
  }
}

export async function deleteCloudConversation(uid: string, convId: string): Promise<void> {
  const safeUid = toSafeFirestoreId(uid);
  const safeConvId = toSafeFirestoreId(convId);
  const path = `users/${safeUid}/conversations/${safeConvId}`;
  try {
    const mq = query(
      collection(db, 'users', safeUid, 'conversations', safeConvId, 'messages'),
      where('userId', '==', safeUid),
      where('conversationId', '==', safeConvId)
    );
    const mSnap = await getDocs(mq);
    const batch = writeBatch(db);
    mSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, 'users', safeUid, 'conversations', safeConvId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function fetchCloudDesigns(uid: string): Promise<VectorDesign[]> {
  const safeUid = toSafeFirestoreId(uid);
  const path = `users/${safeUid}/designs`;
  try {
    const q = query(
      collection(db, 'users', safeUid, 'designs'),
      where('userId', '==', safeUid),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: data.id,
        title: data.title,
        prompt: data.prompt,
        svgCode: data.svgCode,
        aspectRatio: data.aspectRatio,
        palette: [],
        createdAt: data.createdAt?.toMillis?.() || Date.now(),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveCloudDesign(uid: string, design: VectorDesign): Promise<void> {
  const safeUid = toSafeFirestoreId(uid);
  const safeDesignId = toSafeFirestoreId(design.id);
  const path = `users/${safeUid}/designs/${safeDesignId}`;
  try {
    await setDoc(doc(db, 'users', safeUid, 'designs', safeDesignId), {
      id: safeDesignId,
      userId: safeUid,
      title: design.title.slice(0, 200),
      prompt: design.prompt.slice(0, 2000),
      svgCode: design.svgCode.slice(0, 64000),
      aspectRatio: design.aspectRatio,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteCloudDesign(uid: string, designId: string): Promise<void> {
  const safeUid = toSafeFirestoreId(uid);
  const safeDesignId = toSafeFirestoreId(designId);
  const path = `users/${safeUid}/designs/${safeDesignId}`;
  try {
    await deleteDoc(doc(db, 'users', safeUid, 'designs', safeDesignId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
