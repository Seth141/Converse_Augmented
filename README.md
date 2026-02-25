# Converse

Converse is an AI assistant that lives inside your augmented reality glasses and runs silently in the background during your conversations. It listens to what is being said, processes the dialogue in real time, and surfaces concise, useful information directly into your field of view — without interrupting the flow of the interaction.

Built on the AugmentOS SDK and powered by OpenAI, Converse is designed for the way human beings actually talk to each other: fluidly, imprecisely, and continuously.

---

## What It Does

### Real-Time Fact Injection
As a conversation unfolds, Converse listens for claims, topics, and assertions and quietly evaluates them. Within seconds it surfaces a truth confidence score alongside surprising, lesser-known facts related to what was just said. You are never caught off guard by a claim you cannot evaluate.

### Fact-Checking in the Moment
Every statement analyzed receives a plain-language truth assessment — a short summary of the claim and a percentage indicating how well it holds up. This happens continuously and passively. You do not need to ask for it.

### Conversation Enhancement
Converse does not just verify what is said — it enriches it. For every topic detected, it generates unexpected angles, rarely-known connections, and suggested directions the conversation could go next. It makes you a more interesting person to talk to.

### Persistent Conversation Memory
Converse maintains a rolling history of the conversation throughout a session, giving it context to generate responses that are relevant to where the dialogue has been, not just what was said in the last sentence.

### Heads-Up Display Output
All responses are rendered directly to the AR glasses display using a clean text wall layout. Information appears in your peripheral vision exactly when you need it and disappears when you do not.

---

## How It Works

Converse runs as a Third Party Application (TPA) on the AugmentOS platform. When a session begins, the app connects to the glasses via the AugmentOS SDK and subscribes to the live transcription stream. Every finalized utterance is passed to an OpenAI language model along with the conversation history. The model returns a structured response containing a fact-check summary and three insight bullets. That response is immediately pushed to the glasses display.

A background interval also fires every five seconds to generate context-aware insights even during natural pauses in conversation, so there is always something useful ready when you glance at the overlay.

The app exposes a lightweight web interface on port 8080 and the AugmentOS server runs on port 4000.

---

## Response Format

Every insight overlay follows a consistent structure:

```
[3-word claim summary]: [X]% true

- Surprising fact: [5 words]
- Unique angle: [5 words]
- Next direction: [5 words]
```

This format is intentionally compact. AR glasses have limited screen real estate and the overlay must be readable at a glance without demanding your full attention.

---

## Requirements

- [Bun](https://bun.sh) v1.2.4 or later
- An [AugmentOS](https://augmentos.org) developer account and API key
- An [OpenAI](https://platform.openai.com) API key
- AR glasses running AugmentOS

---

## Setup

**1. Install dependencies**

```bash
bun install
```

**2. Configure environment variables**

Create a `.env` file in the project root:

```
MENTRAOS_API_KEY=your_augmentos_api_key
OPENAI_API_KEY=your_openai_api_key
PACKAGE_NAME=com.yourname.converse
```

**3. Run the server**

```bash
bun run src/index.ts
```

The AugmentOS TPA server will start on port 4000 and the web interface will be available at `http://localhost:8080`.

---

## Project Structure

```
converse/
  src/
    index.ts           # Server entry point, session handling, transcription wiring
    MentraAssistant.ts # Core AI logic, conversation history, insight generation
  index.html           # Web interface
  .env                 # Environment variables (not committed)
```

---

## Architecture Notes

- **Conversation history** is capped at 20 messages to stay within token limits while preserving meaningful context.
- **Silence detection** uses a polling interval rather than voice activity detection, keeping the implementation simple and dependency-light.
- **Model selection** currently uses `gpt-3.5-turbo` for low latency. The model can be swapped in `MentraAssistant.ts` for a more capable model if response depth matters more than speed.
- **Session lifecycle** is managed entirely by the AugmentOS SDK. The app reacts to connect, transcription, error, and disconnect events.

---

## Built With

- [AugmentOS SDK](https://github.com/augmentos/augmentos-sdk) — AR glasses platform and TPA framework
- [OpenAI API](https://platform.openai.com/docs) — Language model for insight generation and fact-checking
- [Bun](https://bun.sh) — JavaScript runtime and package manager
- [dotenv](https://github.com/motdotla/dotenv) — Environment variable loading
