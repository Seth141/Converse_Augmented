
import { config } from 'dotenv';
import { TpaServer, TpaSession } from '@augmentos/sdk';
import { MentraAssistant } from './MentraAssistant';
import { showHudText } from './hudDisplay';
import { serve } from "bun";
import { file } from "bun";

// Load environment variables from .env file
config();

// Load configuration from environment variables
const PACKAGE_NAME = process.env.PACKAGE_NAME || "com.sethnuzum.converse";
const BASE_PORT = 4000;
const WEB_PORT = 8080;
const AUGMENTOS_API_KEY = process.env.MENTRAOS_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!AUGMENTOS_API_KEY) {
    console.error("MENTRAOS_API_KEY environment variable is required");
    process.exit(1);
}

if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY environment variable is required");
    process.exit(1);
}

class MyAugmentOSApp extends TpaServer {
    constructor(config: { packageName: string; apiKey: string; port: number }) {
        super(config);
        console.log('MyAugmentOSApp initialized with package:', config.packageName);
    }

    /**
     * AugmentOS waits for this handler to finish before responding 200 to the session webhook.
     * Never block forever here — the cloud will time out, retry, and spawn duplicate sessions.
     */
    protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
        const assistant = new MentraAssistant();

        try {
            console.log('\n=== Session Started ===');
            console.log(`Session ID: ${sessionId}`);
            console.log(`User ID: ${userId}`);
            console.log('======================\n');

            console.log('\n=== Setting up Voice Transcription ===');
            console.log('Initializing transcription handler...');

            // Track how much of a streaming utterance we already processed at a sentence boundary.
            let lastUtteranceId: string | null = null;
            let processedUpTo: number = 0;

            session.events.onTranscription(async (data) => {
                if (!data.text) return;

                const rawData = data as unknown as { utteranceId?: string };
                const uttId = typeof rawData.utteranceId === 'string' ? rawData.utteranceId : null;

                // Reset tracker when a new utterance starts.
                if (uttId && uttId !== lastUtteranceId) {
                    lastUtteranceId = uttId;
                    processedUpTo = 0;
                }

                if (data.isFinal) {
                    // On isFinal, process any remaining text after the last sentence boundary we handled.
                    const remaining = data.text.slice(processedUpTo).trim();
                    processedUpTo = 0;
                    lastUtteranceId = null;

                    if (remaining.length > 0) {
                        console.log('Processing final remainder:', remaining);
                        try {
                            await assistant.handleVoiceCommand(session, remaining, { utteranceId: uttId ?? undefined });
                        } catch (error) {
                            console.error('Error processing voice command:', error);
                        }
                    }
                    return;
                }

                // Interim: look for sentence-ending punctuation in the new portion of text.
                const newText = data.text.slice(processedUpTo);
                const sentenceEnd = /[.?!]/g;
                let lastMatch: RegExpExecArray | null = null;
                let m: RegExpExecArray | null;
                while ((m = sentenceEnd.exec(newText)) !== null) {
                    lastMatch = m;
                }

                if (lastMatch) {
                    const cutIndex = processedUpTo + lastMatch.index + 1;
                    const sentence = data.text.slice(processedUpTo, cutIndex).trim();
                    processedUpTo = cutIndex;

                    if (sentence.length > 0) {
                        console.log('Processing sentence boundary:', sentence);
                        try {
                            await assistant.handleVoiceCommand(session, sentence, { utteranceId: uttId ? `${uttId}_s${cutIndex}` : undefined });
                        } catch (error) {
                            console.error('Error processing voice command:', error);
                        }
                    }
                }
            });

            console.log('Transcription handler setup complete');
            console.log('Voice commands are now active');
            console.log('Insight generator is actively listening');
            console.log('=====================================\n');

            assistant.startSilenceDetection(session);

            session.events.onError((error) => {
                console.error('Session error:', {
                    error: error,
                    sessionId: sessionId,
                    userId: userId,
                    timestamp: new Date().toISOString(),
                });
            });

            session.events.onDisconnected(() => {
                console.log(`Session ${sessionId} disconnected at ${new Date().toISOString()}`);
                assistant.stopSilenceDetection();
            });

            await showHudText(
                session,
                'Converse is ready on two lines\nTen second pause between cards now'
            );
        } catch (error) {
            console.error('Failed to setup session:', error);
            assistant.stopSilenceDetection();
            throw error;
        }
    }
}

// Create and start the app server
const server = new MyAugmentOSApp({
    packageName: PACKAGE_NAME,
    apiKey: AUGMENTOS_API_KEY,
    port: BASE_PORT
});

// Start the web server
const webServer = serve({
    port: WEB_PORT,
    async fetch(req: Request) {
        const url = new URL(req.url);
        if (url.pathname === "/") {
            return new Response(file("index.html"));
        }
        return new Response("Not Found", { status: 404 });
    },
});

server.start().then(() => {
    console.log(`\n=== Server Started ===`);
    console.log(`AugmentOS server running on port ${BASE_PORT}`);
    console.log(`Web server running on http://localhost:${WEB_PORT}`);
    console.log(`Package Name: ${PACKAGE_NAME}`);
    console.log(`API Key: Set`);
    console.log(`Voice Transcription: Enabled`);
    console.log('===================\n');
}).catch(err => {
    console.error('\n=== Server Error ===');
    console.error("Failed to start server:", err);
    console.error('==================\n');
    process.exit(1);
});