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
- Model calls are observable (purpose, outcome, duration, finish reason and reported token usage) and failed runs report a safe failure code, without storing prompts or provider error text
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

## Stateless model contract (v0.8.3)

The agent owns each run's message history. Fake, OpenAI Responses and Gemini Interactions implement
`complete({ messages, tools, signal })`; adapters translate the full transcript and tool JSON schemas
without retaining conversation IDs. Tool authorization, input validation and the three-execution limit
remain in the agent. Existing baseline/structured prompt wording is preserved.

Disconnecting an experiment stream or unmounting its UI cancels the run, including provider HTTP
requests and retry backoff. Started runs are saved as `failed` with the `cancelled` failure code;
a comparison's unstarted second run is not created. A Stop button is planned for v0.9.4.
Cancellation is cooperative: synchronous calculator execution cannot be interrupted mid-expression,
and aborting an HTTP request does not guarantee that a remote service stops computing or billing.

Model events distinguish absent legacy measurements from explicitly unknown values and measured zero.
Usage describes only the returned attempt, not unreported consumption from failed retries. Costs are
not calculated. Full transcripts, tool inputs/outputs and raw provider errors are not stored in model events.
The existing task, final output and handoff output history remains available.

History schema v3 is retained. This release reads existing v1/v2/v3 records without migrating them;
older application releases are not guaranteed to read new measurement fields or cancellation codes.
Only visible text and single-tool-call turns are supported. Models requiring private reasoning replay
or opaque signatures are outside this release's supported scope. Tool schemas use a flat object subset
of JSON Schema (string/number/integer/boolean fields and typed enums); runtime validation belongs to each tool.
No local/OpenAI-compatible endpoint adapter is added here; that is v0.8.4.

## Status

AgentLab is under active development and used as a hands-on learning project. v0.8.3 is implemented and verified with fake/mocked providers only (🟡). Live behavior with real providers is not fully verified yet; automated tests use mocks and never call external APIs. See [ROADMAP.md](ROADMAP.md) for milestones.

## License

[MIT](LICENSE)
