# AgentLab

An experiment lab for observing, testing and comparing how AI agents behave. Run a task, watch the events the system can actually observe, and keep a local history of every experiment.

> 🇹🇷 Türkçe ayrıntılı geliştirme günlüğü için [README.tr.md](README.tr.md) dosyasına bakın.

## Features

- Single-agent experiments with a live event stream and result view
- Fixed experiment scenarios with simple, deterministic PASS/FAIL evaluation
- Controlled two-agent handoff (Analyst to Finalizer) with lifecycle observability
- Same-scenario comparison runs of two agent configurations
- Local experiment history with list and detail views
- Every experiment records how it was produced (provider, model, agent configuration, commit); fake-provider runs are clearly marked
- Model calls are observable (purpose, outcome, duration) and failed runs report a safe failure code, without storing prompts or provider error text
- Providers: a deterministic fake provider, OpenAI and Gemini, with a retry layer

## Getting started

Requirements: a current Node.js LTS release and npm.

```bash
git clone https://github.com/barisgunduztepe/AgentLab.git
cd AgentLab
npm install
cp .env.example .env.local
npm run dev
```

The app starts on `http://127.0.0.1:3000` (the dev server binds to localhost only).

## Configuration

The model provider must be chosen explicitly with `AGENTLAB_MODEL_PROVIDER`, one of `fake`, `openai` or `gemini`. There is no automatic fallback.

- `fake`: deterministic local runs, no API key needed (default in `.env.example`)
- `openai`: set `OPENAI_API_KEY` and `OPENAI_MODEL`
- `gemini`: set `GEMINI_API_KEY` and `GEMINI_MODEL`

Keep real keys in `.env.local` or your server environment. Never commit them.

## Scripts

```bash
npm run dev     # start the dev server
npm run build   # production build
npm run start   # run the production build
npm run lint    # lint
npm test        # run tests (vitest)
```

## Status

AgentLab is under active development and used as a hands-on learning project. Live behavior with real providers is not fully verified yet; automated tests use mocks and never call external APIs. See [ROADMAP.md](ROADMAP.md) for milestones.

## License

[MIT](LICENSE)
