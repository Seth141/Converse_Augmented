import { TpaSession } from '@augmentos/sdk';
import OpenAI from 'openai';
import { showHudText } from './hudDisplay';

const DISPLAY_COOLDOWN_MS = 10_000;
const SILENCE_THRESHOLD_MS = 20_000;
const SILENCE_POLL_MS = 1000;

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const LIVE_MAX_OUTPUT_TOKENS = 180;
const SILENCE_MAX_OUTPUT_TOKENS = 120;
const LIVE_CONTEXT_MESSAGES = 10;
const SILENCE_TRANSCRIPT_MESSAGES = 6;

const MAX_WORDS_PER_LINE = 6;
const MAX_LINES = 2;
const MAX_FACT_LINES = 2;
const SILENCE_VECTOR_LINES = 2;

type ConversationTurn = { role: 'user' | 'assistant' | 'system'; content: string };

type LiveAssistJson = {
    display?: boolean;
    mode?: 'facts' | 'answer' | 'none';
    label?: string;
    facts?: string[];
    answer?: string;
};

function stripNoise(s: string): string {
    return s
        .replace(/\*\*|__|`/g, '')
        .replace(/^[-•*→]\s*/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function toWords(s: string): string[] {
    return stripNoise(s).split(/\s+/).filter(Boolean);
}

function takeWords(text: string, n: number): string {
    return toWords(text).slice(0, n).join(' ');
}

function formatFactsWall(facts: string[]): string | null {
    if (facts.length < MAX_FACT_LINES) return null;
    const l1 = takeWords(facts[0]!, MAX_WORDS_PER_LINE);
    const l2 = takeWords(facts[1]!, MAX_WORDS_PER_LINE);
    if (!l1 || !l2) return null;
    return `${l1}\n${l2}`;
}

function formatAnswerWall(answer: string): string {
    const w = toWords(answer);
    if (w.length === 0) return '';
    if (w.length <= MAX_WORDS_PER_LINE) return w.join(' ');
    const line1 = w.slice(0, MAX_WORDS_PER_LINE).join(' ');
    const line2 = w.slice(MAX_WORDS_PER_LINE, MAX_WORDS_PER_LINE * MAX_LINES).join(' ');
    return `${line1}\n${line2}`;
}

function formatSilenceWall(vectors: string[]): string {
    const l1 = takeWords(vectors[0] ?? '', MAX_WORDS_PER_LINE);
    const l2 = takeWords(vectors[1] ?? '', MAX_WORDS_PER_LINE);
    if (!l1 || !l2) return '';
    return `${l1}\n${l2}`;
}

export class MentraAssistant {
    private conversationHistory: ConversationTurn[] = [];
    private lastHumanSpeechAt: number = Date.now();
    private silenceVectorsEligible: boolean = true;
    private cooldownUntil: number = 0;
    private silenceInterval: NodeJS.Timeout | null = null;
    private openai: OpenAI;
    private readonly model: string;
    /** Monotonically increasing; bumped on every new speech for silence-vector staleness. */
    private speechGeneration: number = 0;
    private lastProcessedUtteranceId: string | null = null;
    private assistInFlight: boolean = false;

    constructor() {
        console.log('Initializing Converse assistant...');
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error('OPENAI_API_KEY not found in environment variables');
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        this.model = (process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
        this.openai = new OpenAI({ apiKey });
        console.log(`OpenAI chat model: ${this.model} (set OPENAI_MODEL to change)`);

        this.conversationHistory.push({
            role: 'system',
            content:
                'AR glasses — JSON only. Respond about the LATEST user line only.\n' +
                'HARD DISPLAY LIMIT: The screen is 6 words wide and 2 lines tall. Every string you return must be AT MOST 6 words. Anything longer gets cut off and the user cannot read it. Count your words before responding.\n' +
                'facts (default): When someone mentions a place, topic, hobby, plant, animal, product, event — return exactly 2 strings in "facts". Each string MUST be 4–6 words: a real claim (number, history, nature), not a label. If two things are mentioned, facts[0] = about first, facts[1] = about second.\n' +
                'answer: ONLY for clear math, tip calc, or short definition/acronym. Put result in "answer" — max 6 words on one line, or max 12 words split across two lines (first 6 words = line 1, next 6 = line 2).\n' +
                'none: filler/backchannel.\n' +
                'JSON: {"display":boolean,"mode":"facts"|"answer"|"none","label":"","facts":[],"answer":""}',
        });

        console.log('Converse assistant initialized');
    }

    private isInCooldown(): boolean {
        return Date.now() < this.cooldownUntil;
    }

    private beginCooldown(): void {
        this.cooldownUntil = Date.now() + DISPLAY_COOLDOWN_MS;
        console.log(`Cooldown ${DISPLAY_COOLDOWN_MS / 1000}s until next glasses update`);
    }

    private trimHistory(): void {
        const maxTurns = 20;
        if (this.conversationHistory.length > maxTurns) {
            const [system, ...rest] = this.conversationHistory;
            this.conversationHistory = [system!, ...rest.slice(-(maxTurns - 1))];
        }
    }

    private messagesForLiveCompletion(): { role: 'system' | 'user' | 'assistant'; content: string }[] {
        const sys = this.conversationHistory[0];
        if (!sys || sys.role !== 'system') {
            return this.conversationHistory.map((m) => ({
                role: m.role as 'system' | 'user' | 'assistant',
                content: m.content,
            }));
        }
        const recent = this.conversationHistory.slice(1).slice(-LIVE_CONTEXT_MESSAGES);
        return [sys, ...recent].map((m) => ({
            role: m.role as 'system' | 'user' | 'assistant',
            content: m.content,
        }));
    }

    private liveAssistToWall(parsed: LiveAssistJson): string | null {
        if (!parsed.display || parsed.mode === 'none') return null;
        if (parsed.mode === 'answer') {
            const a = parsed.answer?.trim();
            if (!a) return null;
            return formatAnswerWall(a);
        }
        if (parsed.mode === 'facts') {
            const facts = parsed.facts ?? [];
            const good = facts.map((f) => stripNoise(f)).filter(Boolean);
            return formatFactsWall(good);
        }
        return null;
    }

    private async generateLiveAssist(session: TpaSession): Promise<void> {
        const completion = await this.openai.chat.completions.create({
            model: this.model,
            messages: this.messagesForLiveCompletion(),
            response_format: { type: 'json_object' },
            max_completion_tokens: LIVE_MAX_OUTPUT_TOKENS,
            temperature: 0.45,
        });

        const raw = completion.choices[0]?.message?.content?.trim();
        if (!raw) return;

        let parsed: LiveAssistJson;
        try {
            parsed = JSON.parse(raw) as LiveAssistJson;
        } catch {
            console.error('Failed to parse live assist JSON:', raw);
            return;
        }

        const wall = this.liveAssistToWall(parsed);
        if (!wall?.trim()) return;

        showHudText(session, wall);
        this.conversationHistory.push({ role: 'assistant', content: wall });
        this.trimHistory();
        this.beginCooldown();
    }

    private async generateSilenceVectors(session: TpaSession): Promise<void> {
        const transcript = this.conversationHistory
            .filter((m) => m.role !== 'system')
            .slice(-SILENCE_TRANSCRIPT_MESSAGES)
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n');

        if (!transcript.trim()) return;

        const gen = this.speechGeneration;

        const completion = await this.openai.chat.completions.create({
            model: this.model,
            messages: [
                {
                    role: 'system',
                    content:
                        '~20s silence. 2 conversation directions tied to the transcript, max 6 words each. JSON: {"vectors":["...","..."]}',
                },
                { role: 'user', content: transcript },
            ],
            response_format: { type: 'json_object' },
            max_completion_tokens: SILENCE_MAX_OUTPUT_TOKENS,
            temperature: 0.7,
        });

        if (gen !== this.speechGeneration) return;

        const raw = completion.choices[0]?.message?.content?.trim();
        if (!raw) return;

        let parsed: { vectors?: string[] };
        try {
            parsed = JSON.parse(raw) as { vectors?: string[] };
        } catch {
            console.error('Failed to parse silence vectors JSON:', raw);
            return;
        }

        const lines = (parsed.vectors ?? [])
            .map((v) => stripNoise(v))
            .filter(Boolean)
            .slice(0, SILENCE_VECTOR_LINES);

        if (lines.length < SILENCE_VECTOR_LINES) return;

        const silenceWall = formatSilenceWall(lines);
        if (!silenceWall.trim()) return;

        showHudText(session, silenceWall);
        this.beginCooldown();
        this.silenceVectorsEligible = false;
    }

    public async handleVoiceCommand(
        session: TpaSession,
        text: string,
        options?: { utteranceId?: string },
    ): Promise<void> {
        const trimmed = text.trim();
        if (!trimmed) return;

        const uid = options?.utteranceId;
        if (uid && uid === this.lastProcessedUtteranceId) {
            console.log('Skipping duplicate final for utteranceId:', uid);
            return;
        }
        if (uid) this.lastProcessedUtteranceId = uid;

        console.log('Transcript (final):', trimmed);
        this.lastHumanSpeechAt = Date.now();
        this.silenceVectorsEligible = true;
        this.speechGeneration++;

        this.conversationHistory.push({ role: 'user', content: trimmed });
        this.trimHistory();

        if (this.isInCooldown() || this.assistInFlight) {
            if (this.isInCooldown()) console.log('Skipping live assist (cooldown active)');
            return;
        }

        this.assistInFlight = true;
        try {
            await this.generateLiveAssist(session);
        } catch (error) {
            console.error('Error in live assist:', error);
        } finally {
            this.assistInFlight = false;
        }
    }

    public startSilenceDetection(session: TpaSession): void {
        if (this.silenceInterval) clearInterval(this.silenceInterval);

        this.silenceInterval = setInterval(async () => {
            if (this.isInCooldown() || !this.silenceVectorsEligible) return;
            if (Date.now() - this.lastHumanSpeechAt < SILENCE_THRESHOLD_MS) return;
            try {
                await this.generateSilenceVectors(session);
            } catch (error) {
                console.error('Error generating silence vectors:', error);
            }
        }, SILENCE_POLL_MS);
    }

    public stopSilenceDetection(): void {
        if (this.silenceInterval) {
            clearInterval(this.silenceInterval);
            this.silenceInterval = null;
        }
    }
}
