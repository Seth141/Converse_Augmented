import { TpaSession } from '@augmentos/sdk';
import OpenAI from 'openai';

export class MentraAssistant {
    private conversationHistory: { role: string, content: string }[] = [];
    private lastSpeechTime: number = Date.now();
    private suggestionInterval: number = 5000; // 5 seconds between suggestions
    private silenceCheckInterval: NodeJS.Timeout | null = null;
    private openai: OpenAI;

    constructor() {
        console.log('Initializing Insight Coach...');
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error('OPENAI_API_KEY not found in environment variables');
            throw new Error("OPENAI_API_KEY environment variable is required");
        }
        
        this.openai = new OpenAI({
            apiKey: apiKey
        });

        // Initialize conversation history with system message
        this.conversationHistory.push({
            role: "system",
            content: "You are an insight generator integrated into AR glasses, focused on providing fascinating, rarely-known facts and unique perspectives. Your role is to:\n" +
                    "1. Listen to conversations and identify the core topics and themes\n" +
                    "2. Analyze the truthfulness of the most recent statement and provide:\n" +
                    "   - A 3-word summary of the claim\n" +
                    "   - A truth percentage (1-100%)\n" +
                    "3. Generate three 5-word related facts and interesting angles that are:\n" +
                    "   - Genuinely surprising or lesser-known facts\n" +
                    "   - Unique angles or unexpected connections\n" +
                    "   - Thought-provoking conversation directions\n" +
                    "4. Format responses with truth analysis first, then bullet points\n" +
                    "5. Focus on the most interesting aspects\n" +
                    "6. Prioritize uncommon knowledge over basic facts\n\n" +
                    "Always structure your response as:\n" +
                    "[3-word claim summary]: [X]% true\n\n" +
                    "• Surprising fact: [5 words]\n" +
                    "• Unique angle: [5 words]\n" +
                    "• Next direction: [5 words]"
        });
        
        console.log('Insight Coach initialized');
    }

    private async generateInsights(session: TpaSession): Promise<void> {
        try {
            const completion = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    ...this.conversationHistory,
                    {
                        role: "system",
                        content: "Based on the conversation context:\n1. Analyze the latest statement and provide a 3-word summary with truth percentage (1-100%)\n2. Generate three 5-word insights that are genuinely surprising or unique.\nFormat as '[3-word summary]: [X]% true' followed by bullet points with labels 'Surprising fact:', 'Unique angle:', and 'Next direction:'. Each insight must be exactly 5 words and truly fascinating."
                    }
                ],
                max_tokens: 150,
                temperature: 0.9 // Increased for more creative responses
            });

            const response = completion.choices[0]?.message?.content;
            if (response && response.trim() !== "") {
                await session.layouts.showTextWall(response);
                this.conversationHistory.push({
                    role: "assistant",
                    content: response
                });
            }

        } catch (error) {
            console.error('Error generating insights:', error);
        }
    }

    public async handleVoiceCommand(session: TpaSession, text: string): Promise<void> {
        console.log('Processing conversation:', text);
        this.lastSpeechTime = Date.now();

        try {
            // Add the conversation to history
            this.conversationHistory.push({
                role: "user",
                content: `Topic discussed: ${text}`
            });

            // Keep conversation history limited
            if (this.conversationHistory.length > 20) {
                this.conversationHistory = [
                    this.conversationHistory[0], // Keep system message
                    ...this.conversationHistory.slice(-19)
                ];
            }

            await this.generateInsights(session);

        } catch (error) {
            console.error('Error processing conversation:', error);
        }
    }

    public startSilenceDetection(session: TpaSession): void {
        if (this.silenceCheckInterval) {
            clearInterval(this.silenceCheckInterval);
        }

        // Generate insights every 5 seconds
        this.silenceCheckInterval = setInterval(async () => {
            await this.generateInsights(session);
        }, this.suggestionInterval);
    }

    public stopSilenceDetection(): void {
        if (this.silenceCheckInterval) {
            clearInterval(this.silenceCheckInterval);
            this.silenceCheckInterval = null;
        }
    }
} // End of MentraAssistant class 