import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('GEMINI_API_KEY is not configured on the server.'), { status: 500 });
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      const isRetryable = status === 429 || (typeof status === 'number' && status >= 500);
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

interface ParsedError {
  status: number;
  messageEn: string;
  messageAr: string;
}

function parseGeminiError(err: unknown): ParsedError {
  const anyErr = err as { status?: number; message?: string };
  const rawMessage = anyErr?.message || String(err);
  const status = typeof anyErr?.status === 'number' ? anyErr.status : 500;

  if (status === 403 || status === 400 && rawMessage.includes('API_KEY_INVALID')) {
    return {
      status,
      messageEn: 'Invalid or missing API key. Please check Settings > Secrets.',
      messageAr: 'مفتاح API غير صالح أو مفقود. يرجى التحقق منه في Settings > Secrets.',
    };
  }
  if (status === 429 || rawMessage.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      messageEn: 'Rate limit or quota reached. Please wait a moment and try again.',
      messageAr: 'تم الوصول للحد الأقصى من الطلبات مؤقتاً. يرجى الانتظار قليلاً ثم المحاولة.',
    };
  }
  if (status === 404 || rawMessage.includes('NOT_FOUND')) {
    return {
      status: 404,
      messageEn: 'Requested model is currently unavailable.',
      messageAr: 'النموذج المطلوب غير متاح حالياً.',
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 500,
    messageEn: rawMessage || 'Unexpected AI service error.',
    messageAr: rawMessage || 'حدث خطأ غير متوقع أثناء معالجة الطلب.',
  };
}

function mapThinkingLevel(level?: string): ThinkingLevel {
  switch (level) {
    case 'LOW':
      return ThinkingLevel.LOW;
    case 'MEDIUM':
      return ThinkingLevel.MEDIUM;
    case 'XHIGH':
      return ThinkingLevel.XHIGH;
    case 'HIGH':
    default:
      return ThinkingLevel.HIGH;
  }
}

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // 1. Streaming Chat + Search Grounding + URL Context + Multimodal Attachment
  app.post('/api/chat/stream', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const {
        messages = [],
        systemInstruction = '',
        thinkingLevel = 'HIGH',
        useSearch = false,
        useUrlContext = false,
        attachment = null,
      } = req.body as {
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
        systemInstruction?: string;
        thinkingLevel?: string;
        useSearch?: boolean;
        useUrlContext?: boolean;
        attachment?: { name: string; mimeType: string; data: string } | null;
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        sendEvent({
          type: 'error',
          messageEn: 'Message history cannot be empty.',
          messageAr: 'لا يمكن إرسال محادثة فارغة.',
        });
        res.end();
        return;
      }

      const ai = getAiClient();

      const contents = messages.map((msg, idx) => {
        const isLastUser = idx === messages.length - 1 && msg.role === 'user';
        const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

        if (isLastUser && attachment?.data && attachment?.mimeType) {
          parts.push({
            inlineData: {
              mimeType: attachment.mimeType,
              data: attachment.data,
            },
          });
        }
        parts.push({ text: msg.content });

        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts,
        };
      });

      const tools: Array<Record<string, unknown>> = [];
      if (useSearch) tools.push({ googleSearch: {} });
      if (useUrlContext) tools.push({ urlContext: {} });

      const config: Record<string, unknown> = {
        thinkingConfig: {
          thinkingLevel: mapThinkingLevel(thinkingLevel),
        },
      };

      if (systemInstruction.trim()) {
        config.systemInstruction = systemInstruction.trim();
      }
      if (tools.length > 0) {
        config.tools = tools;
      }

      const stream = await withRetry(() =>
        ai.models.generateContentStream({
          model: 'gemini-4-hydrogen',
          contents,
          config,
        })
      );

      const collectedSources = new Map<string, { title: string; uri: string }>();

      for await (const chunk of stream) {
        if (chunk.text) {
          sendEvent({ type: 'chunk', text: chunk.text });
        }
        const groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (Array.isArray(groundingChunks)) {
          for (const gc of groundingChunks) {
            if (gc?.web?.uri) {
              collectedSources.set(gc.web.uri, {
                title: gc.web.title || gc.web.uri,
                uri: gc.web.uri,
              });
            }
          }
        }
      }

      if (collectedSources.size > 0) {
        sendEvent({ type: 'sources', sources: Array.from(collectedSources.values()).slice(0, 10) });
      }
      sendEvent({ type: 'done' });
      res.end();
    } catch (err) {
      const parsed = parseGeminiError(err);
      sendEvent({
        type: 'error',
        status: parsed.status,
        messageEn: parsed.messageEn,
        messageAr: parsed.messageAr,
      });
      res.end();
    }
  });

  // 2. Document & Multimodal Analyzer (SSE)
  app.post('/api/analyze', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const { file, prompt, taskType, language } = req.body as {
        file?: { name: string; mimeType: string; data: string; textPreview?: string };
        prompt: string;
        taskType?: string;
        language?: 'ar' | 'en';
      };

      if (!file && !prompt?.trim()) {
        sendEvent({
          type: 'error',
          messageEn: 'Please provide a file or text prompt to analyze.',
          messageAr: 'يرجى رفع ملف أو إدخال نص للتحليل.',
        });
        res.end();
        return;
      }

      const ai = getAiClient();
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

      if (file?.data && file?.mimeType) {
        parts.push({
          inlineData: {
            mimeType: file.mimeType,
            data: file.data,
          },
        });
      }

      const langDirective =
        language === 'en'
          ? 'Respond clearly in well-structured English Markdown.'
          : 'أجب باللغة العربية الفصحى الواضحة وبصيغة Markdown منظمة ومفيدة.';

      const instruction = [
        langDirective,
        taskType ? `Requested analysis mode: ${taskType}.` : '',
        prompt?.trim() || 'Provide a comprehensive analysis of the uploaded content.',
      ]
        .filter(Boolean)
        .join('\n\n');

      parts.push({ text: instruction });

      const stream = await withRetry(() =>
        ai.models.generateContentStream({
          model: 'gemini-4-hydrogen',
          contents: [{ role: 'user', parts }],
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          },
        })
      );

      for await (const chunk of stream) {
        if (chunk.text) {
          sendEvent({ type: 'chunk', text: chunk.text });
        }
      }
      sendEvent({ type: 'done' });
      res.end();
    } catch (err) {
      const parsed = parseGeminiError(err);
      sendEvent({
        type: 'error',
        status: parsed.status,
        messageEn: parsed.messageEn,
        messageAr: parsed.messageAr,
      });
      res.end();
    }
  });

  // 3. Vector & Diagram Studio (SVG Generation via Structured Output)
  app.post('/api/canvas/generate', async (req: Request, res: Response) => {
    try {
      const { prompt, style = 'illustration', aspectRatio = '1:1', previousSvg = '', language = 'ar' } =
        req.body as {
          prompt: string;
          style?: string;
          aspectRatio?: string;
          previousSvg?: string;
          language?: 'ar' | 'en';
        };

      if (!prompt?.trim()) {
        res.status(400).json({
          error: language === 'ar' ? 'يرجى كتابة وصف للتصميم المطلوب.' : 'Please enter a design prompt.',
        });
        return;
      }

      const dimensionsMap: Record<string, { w: number; h: number }> = {
        '1:1': { w: 800, h: 800 },
        '16:9': { w: 960, h: 540 },
        '4:3': { w: 800, h: 600 },
        '3:4': { w: 600, h: 800 },
      };
      const dims = dimensionsMap[aspectRatio] || dimensionsMap['1:1'];

      const ai = getAiClient();
      const systemInstruction = `You are a master vector graphic designer and technical diagram architect.
Generate clean, self-contained, high-craft SVG artwork using viewBox="0 0 ${dims.w} ${dims.h}" width="100%" height="100%".
Rules:
- Use rich layered shapes, gradients (<defs><linearGradient>...), crisp typography (supports Arabic & English), balanced whitespace, and cohesive harmonious color palettes.
- NEVER include <script>, external <image href="http...">, or event handlers.
- If previousSvg is provided, refine and transform it according to the user's edit request while keeping visual coherence.
- Return valid JSON matching the schema.`;

      const fullPrompt = [
        `Design category: ${style}.`,
        `Aspect ratio: ${aspectRatio} (viewBox 0 0 ${dims.w} ${dims.h}).`,
        `Language context for any labels: ${language === 'ar' ? 'Arabic (or clean universal symbols)' : 'English'}.`,
        previousSvg ? `Existing SVG to modify:\n${previousSvg}\n` : '',
        `User request: ${prompt.trim()}`,
      ]
        .filter(Boolean)
        .join('\n');

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: fullPrompt,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: 'Short concise title for the artwork' },
                description: { type: Type.STRING, description: 'Brief description of the visual composition' },
                svgCode: { type: Type.STRING, description: 'Complete valid <svg ...>...</svg> markup' },
                palette: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: '3 to 5 hex colors used in the SVG',
                },
              },
              required: ['title', 'description', 'svgCode', 'palette'],
            },
          },
        })
      );

      const raw = (response.text || '{}').trim();
      const parsed = JSON.parse(raw) as {
        title: string;
        description: string;
        svgCode: string;
        palette: string[];
      };

      const cleanSvg = sanitizeSvg(parsed.svgCode || '');
      if (!cleanSvg.startsWith('<svg')) {
        res.status(500).json({
          error: language === 'ar' ? 'تعذر إنشاء رسم متجه صالح، يرجى إعادة المحاولة.' : 'Could not generate valid SVG markup.',
        });
        return;
      }

      res.json({
        title: parsed.title || prompt.slice(0, 60),
        description: parsed.description || '',
        svgCode: cleanSvg,
        palette: Array.isArray(parsed.palette) ? parsed.palette.slice(0, 5) : [],
      });
    } catch (err) {
      const parsed = parseGeminiError(err);
      res.status(parsed.status).json({ error: parsed.messageAr, errorEn: parsed.messageEn });
    }
  });

  // 4. Audio Transcription (STT via gemini-3.5-transcribe)
  app.post('/api/audio/transcribe', async (req: Request, res: Response) => {
    try {
      const { mimeType, data, language = 'ar' } = req.body as {
        mimeType: string;
        data: string;
        language?: 'ar' | 'en';
      };

      if (!data || !mimeType) {
        res.status(400).json({
          error: language === 'ar' ? 'ملف الصوت مفقود.' : 'Audio payload is missing.',
        });
        return;
      }

      const ai = getAiClient();
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data,
                },
              },
              {
                text: 'Transcribe this audio accurately in its spoken language. Preserve punctuation and paragraph breaks cleanly without adding commentary.',
              },
            ],
          },
        })
      );

      res.json({ text: (response.text || '').trim() });
    } catch (err) {
      const parsed = parseGeminiError(err);
      res.status(parsed.status).json({ error: parsed.messageAr, errorEn: parsed.messageEn });
    }
  });

  // 5. Text-to-Speech (Single speaker gemini-3.8-flash-lite-tts & Dual speaker gemini-3.8-flash-tts)
  app.post('/api/audio/tts', async (req: Request, res: Response) => {
    try {
      const {
        mode = 'single',
        text = '',
        voiceName = 'Kore',
        style = 'Clear, natural, expressive narrator',
        dialogueLines = [],
        speaker1Voice = 'Puck',
        speaker2Voice = 'Kore',
      } = req.body as {
        mode?: 'single' | 'dual';
        text?: string;
        voiceName?: string;
        style?: string;
        dialogueLines?: Array<{ speaker: string; text: string; style?: string }>;
        speaker1Voice?: string;
        speaker2Voice?: string;
      };

      const ai = getAiClient();

      if (mode === 'dual') {
        if (!Array.isArray(dialogueLines) || dialogueLines.length < 2) {
          res.status(400).json({ error: 'Dual speaker mode requires at least 2 dialogue lines.' });
          return;
        }

        const speakers = Array.from(new Set(dialogueLines.map((l) => l.speaker.trim()).filter(Boolean))).slice(0, 2);
        const s1 = speakers[0] || 'Host';
        const s2 = speakers[1] || 'Guest';

        const response = await withRetry(() =>
          ai.models.generateContent({
            model: 'gemini-3.8-flash-tts',
            contents: [
              {
                role: 'user',
                parts: dialogueLines.map((line) => ({
                  text: `${line.speaker}: ${line.text}`,
                  speechMetadata: {
                    speaker: line.speaker === s2 ? s2 : s1,
                    style: line.style || 'Natural conversational podcast tone',
                  },
                })),
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                multiSpeakerVoiceConfig: {
                  speakerVoiceConfigs: [
                    {
                      speaker: s1,
                      voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker1Voice } },
                    },
                    {
                      speaker: s2,
                      voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker2Voice } },
                    },
                  ],
                },
              },
            },
          })
        );

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) {
          res.status(500).json({ error: 'No audio was returned by the speech model.' });
          return;
        }
        res.json({ audioBase64: base64Audio, mimeType: 'audio/wav' });
        return;
      }

      // Single-speaker mode
      const cleanText = text.trim().slice(0, 4500);
      if (!cleanText) {
        res.status(400).json({ error: 'Text input is required for speech synthesis.' });
        return;
      }

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: cleanText,
                  speechMetadata: {
                    style,
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        })
      );

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        res.status(500).json({ error: 'No audio was returned by the speech model.' });
        return;
      }
      res.json({ audioBase64: base64Audio, mimeType: 'audio/wav' });
    } catch (err) {
      const parsed = parseGeminiError(err);
      res.status(parsed.status).json({ error: parsed.messageAr, errorEn: parsed.messageEn });
    }
  });

  // 6. Generate 2-speaker podcast dialogue script
  app.post('/api/audio/script', async (req: Request, res: Response) => {
    try {
      const { topic, language = 'ar' } = req.body as { topic: string; language?: 'ar' | 'en' };
      if (!topic?.trim()) {
        res.status(400).json({ error: language === 'ar' ? 'يرجى كتابة موضوع الحوار.' : 'Please provide a topic.' });
        return;
      }

      const ai = getAiClient();
      const prompt =
        language === 'ar'
          ? `اكتب حوار بودكاست قصير وجذاب من 4 إلى 6 فقرات بين متحدثين (طارق وليلى) باللغة العربية الواضحة حول موضوع: ${topic.trim()}`
          : `Write a short, engaging 4-to-6 turn podcast dialogue between two hosts (Alex and Sam) in English about: ${topic.trim()}`;

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  speaker: { type: Type.STRING },
                  text: { type: Type.STRING },
                  style: { type: Type.STRING },
                },
                required: ['speaker', 'text', 'style'],
              },
            },
          },
        })
      );

      const lines = JSON.parse((response.text || '[]').trim());
      res.json({ lines });
    } catch (err) {
      const parsed = parseGeminiError(err);
      res.status(parsed.status).json({ error: parsed.messageAr, errorEn: parsed.messageEn });
    }
  });

  // Vite middleware in dev, static serving in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Nuha AI Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
