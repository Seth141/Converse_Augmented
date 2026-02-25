
import { config } from 'dotenv';
import { TpaServer, TpaSession } from '@augmentos/sdk';
import { MentraAssistant } from './MentraAssistant';
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
    private assistant: MentraAssistant;

    constructor(config: { packageName: string; apiKey: string; port: number }) {
        super(config);
        this.assistant = new MentraAssistant();
        console.log('MyAugmentOSApp initialized with package:', config.packageName);
    }

    protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
        try {
            console.log('\n=== Session Started ===');
            console.log(`Session ID: ${sessionId}`);
            console.log(`User ID: ${userId}`);
            console.log('======================\n');

            // Set up voice command handling with enhanced debugging
            console.log('\n=== Setting up Voice Transcription ===');
            console.log('Initializing transcription handler...');
            
            try {
                // Set up transcription event handler
                session.events.onTranscription(async (data) => {
                    console.log('\n=== Transcription Event Received ===');
                    console.log('Raw transcription data:', data);
                    
                    if (data.text) {
                        console.log('Transcribed text:', data.text);
                        console.log('Is final:', data.isFinal);
                        
                        if (data.isFinal) {
                            console.log('Processing final transcription');
                            try {
                                await this.assistant.handleVoiceCommand(session, data.text);
                                console.log('Voice command processed successfully');
                            } catch (error) {
                                console.error('Error processing voice command:', error);
                            }
                        }
                    } else {
                        console.log('No text in transcription data');
                    }
                });

                console.log('Transcription handler setup complete');
                console.log('Voice commands are now active');
                console.log('Insight generator is actively listening');
                console.log('=====================================\n');

                // Start silence detection
                this.assistant.startSilenceDetection(session);

                // Display welcome message
                await session.layouts.showTextWall("I'll provide fascinating facts and unique perspectives about your conversations every 5 seconds.");

                // Set up error handling with more detail
                session.events.onError((error) => {
                    console.error('Session error:', {
                        error: error,
                        sessionId: sessionId,
                        userId: userId,
                        timestamp: new Date().toISOString()
                    });
                });

                session.events.onDisconnected(() => {
                    console.log(`Session ${sessionId} disconnected at ${new Date().toISOString()}`);
                    this.assistant.stopSilenceDetection();
                });

                // Keep the session alive
                await new Promise(() => {}); // This keeps the session open

            } catch (error) {
                console.error('Failed to setup transcription handler:', error);
                throw error;
            }

        } catch (error) {
            console.error('Session error:', error);
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
    async fetch(req) {
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