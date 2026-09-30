import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const port = Number(process.env.PORT) || 3000;
const app = express();
const server = http.createServer(app);

app.use(express.json());

// API health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TNU Faculty Recruitment Portal',
    liveModel: 'gemini-3.8-live',
    apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
  });
});

// Setup WebSocket for Gemini Live API audio streaming
const wss = new WebSocketServer({ server, path: '/live' });

wss.on('connection', async (clientWs: WebSocket) => {
  console.log('[Gemini Live] Client connected to real-time voice endpoint');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    clientWs.send(
      JSON.stringify({
        error: 'GEMINI_API_KEY is not configured on the server. Please attach an API key in Secrets.',
      })
    );
    return;
  }

  let session: any = null;

  try {
    const ai = new GoogleGenAI({ apiKey });

    session = await ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
        },
        systemInstruction: `You are Dr. Neotia, the official Academic Recruitment & Faculty Admissions Advisor for The Neotia University (TNU), established in 2015 and recognized under Section 2(f) of the UGC Act 1956.
You converse via real-time spoken voice with aspiring faculty members, researchers, and professors exploring academic career opportunities.
Tone: Polite, knowledgeable, distinguished, warm, and academically encouraging.
Key University Details:
- Campus Location: Sarisha Campus on Diamond Harbour Road, South 24 Parganas, West Bengal (45 minutes from Kolkata).
- Academic Cadres: Assistant Professor, Associate Professor, and Chair Professor positions.
- Currently Active Stream: School of Technology (Specializations in: 1) Artificial Intelligence & Machine Learning - 3 openings; 2) Cyber Security & Cloud Infrastructure - 2 openings; 3) Data Science & Computational Intelligence - 1 opening; 4) Robotics & IoT - 2 openings).
- Compensation: 7th Central Pay Commission (CPC) scale, seed research grants up to ₹10 Lakhs, performance bonuses, and campus housing.
- Key Qualifications: First class B.Tech/M.Tech and Ph.D. in relevant computing fields with indexed SCI/Scopus journal publications.
- Application Deadline: Priority rolling review until March 31, 2026.
Keep your spoken responses natural, concise (1 to 3 sentences per turn), and conversational so the user has an effortless voice conversation.`,
        outputAudioTranscription: {},
        inputAudioTranscription: {},
      },
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          try {
            // Model turn audio parts
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts && parts.length > 0) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
                }
                if (part.text) {
                  clientWs.send(JSON.stringify({ text: part.text, role: 'model' }));
                }
              }
            }

            // Output transcription
            const outputTrans = (message as any).serverContent?.outputAudioTranscription?.text;
            if (outputTrans) {
              clientWs.send(JSON.stringify({ text: outputTrans, role: 'model' }));
            }

            // Input transcription
            const inputTrans = (message as any).serverContent?.inputAudioTranscription?.text;
            if (inputTrans) {
              clientWs.send(JSON.stringify({ text: inputTrans, role: 'user' }));
            }

            // Interruption signal (when user starts speaking while model is speaking)
            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }

            // Turn completion
            if (message.serverContent?.turnComplete) {
              clientWs.send(JSON.stringify({ turnComplete: true }));
            }
          } catch (sendErr) {
            console.error('[Gemini Live] Error forwarding message to client:', sendErr);
          }
        },
        onerror: (err: any) => {
          console.error('[Gemini Live] Session error:', err);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({
                error: err?.message || 'Live session encountered an error',
              })
            );
          }
        },
        onclose: () => {
          console.log('[Gemini Live] Session closed');
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ closed: true }));
          }
        },
      },
    });

    clientWs.send(JSON.stringify({ connected: true, voice: 'Zephyr', model: 'gemini-3.8-live' }));
  } catch (err: any) {
    console.error('[Gemini Live] Failed to connect:', err);
    clientWs.send(
      JSON.stringify({
        error: err?.message || 'Could not connect to Gemini 3.8 Live API.',
      })
    );
    return;
  }

  clientWs.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.audio && session) {
        session.sendRealtimeInput({
          audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
        });
      } else if (msg.text && session) {
        session.sendRealtimeInput({
          text: msg.text,
        });
      }
    } catch (err) {
      console.error('[Gemini Live] Error handling client input:', err);
    }
  });

  clientWs.on('close', () => {
    console.log('[Gemini Live] Client disconnected');
    if (session) {
      try {
        session.close();
      } catch (e) {
        // cleanup error ignored
      }
    }
  });
});

// Middleware & Server startup
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
      res.sendFile('dist/index.html', { root: '.' });
    });
  }

  server.listen(port, () => {
    console.log(`[TNU Server] Dev server running on http://localhost:${port}`);
  });
}

startServer();
