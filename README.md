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
- Providers: a deterministic fake provider, OpenAI Responses, Gemini Interactions and a local OpenAI-compatible Chat Completions adapter, with a retry layer

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

The model provider must be chosen explicitly with `AGENTLAB_MODEL_PROVIDER`, one of `fake`, `openai`, `gemini` or `openai-compatible`. There is no automatic fallback.

- `fake`: deterministic local runs, no API key needed (default in `.env.example`)
- `openai`: set `OPENAI_API_KEY` and `OPENAI_MODEL`
- `gemini`: set `GEMINI_API_KEY` and `GEMINI_MODEL`
- `openai-compatible`: set `OPENAI_COMPATIBLE_BASE_URL` (include `/v1`, e.g. `http://127.0.0.1:11434/v1`) and `OPENAI_COMPATIBLE_MODEL`; `OPENAI_COMPATIBLE_API_KEY` is optional. This adapter uses Chat Completions, not Responses. No endpoint or model is selected automatically. Cloud OpenAI keys/organization/project headers are not inherited; keyless local requests have no Authorization header.

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
The separate local/OpenAI-compatible Chat Completions adapter was added in v0.8.4.

## Manual local smoke (v0.8.4)

Use an already installed and running loopback server with an already installed tool-capable model.
The script never installs software or downloads a model. Configure the three `OPENAI_COMPATIBLE_*`
variables above in `.env.local` or your shell (only the URL and model are required), then run:

```bash
npm run smoke:local -- --check  # GET /v1/models only; no model generation
npm run smoke:local            # text, sequential calculator calls, then cancellation
npm run smoke:local -- --record # same live run, plus sanitized response fixtures
```

The manual script is not run by `npm test` or CI. It always uses the local compatible adapter,
regardless of the application's selected provider, and rejects non-loopback URLs and redirects.
A missing endpoint/model stops execution before generation. Unexpected model behavior stops the
remaining scenarios and exits with a failure. The calculator task must actually use the model and
execute at least two calculator turns; the final expected result is 410. Cancellation begins after
fetch dispatch. If the model finishes before cancellation, the smoke reports failure rather than
claiming cancellation was verified.

JSON output includes per-scenario finish reason, reported usage, duration, event counts and transport
cancellation evidence. It omits prompts, answers, tool content, call IDs, keys and endpoint URLs.
No user history is written: execution uses `runExperiment` without the history store, and the runner
sets temporary `LOCALAPPDATA`/`XDG_DATA_HOME`. Existing TypeScript compiles the manual runner into a
fresh temporary directory, which is removed afterward; no extra dependency is needed.

`--record` is manual only. It writes new timestamped files under `src/agent/providers/fixtures/local`
without overwriting prior captures. Before writing, it allowlists visible assistant content, tool-call
structure and reported finish/usage; IDs are normalized and `created` is zeroed. Reasoning fields,
inline think blocks, fingerprints, requests, headers, keys, addresses and unused fields are excluded.
These fixed smoke-response fixtures contain visible text/tool arguments; application history and model
events retain their existing privacy contract. Token counts remain as reported by the server.

Automatic tests use mocked HTTP, including replay of genuinely captured Ollama responses: qwen3:8b
text and a two-turn calculator loop, and llama3.1:8b text and a rejected two-call response. No completed
cancellation response or failed single-call llama response was available to record. See
[fixture provenance and contents](src/agent/providers/fixtures/local/README.md) and
[the v0.8.4 validation report](docs/v0.8.4-validation.md) for measurements and adapter-specific status.

## Status

AgentLab is under active development and used as a hands-on learning project. v0.8 (Measurable core) is complete.
v0.8.4 is ✅ specifically for the OpenAI-compatible adapter live-validated with **qwen3:8b**: text, two sequential
calculator turns and client HTTP cancellation. Real-response replay runs offline. This is not a blanket
compatibility claim: llama3.1:8b failed the single-call-per-response tool contract; its cancellation scenario
was not reached. OpenAI Responses and Gemini Interactions remain 🟡 without live verification. HTTP abort
does not prove server-side generation stopped; reasoning is not recorded. The next milestone is **v0.9.1**.
Automated tests never call real model endpoints. See [ROADMAP.md](ROADMAP.md) for scope and remaining work.

## License

[MIT](LICENSE)
