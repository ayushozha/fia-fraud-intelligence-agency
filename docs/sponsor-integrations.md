# Sponsor integration notes

Researched 2026-09-27 from sponsor repos/docs. Verify against the pinned revision before relying on a detail; record pins in `integration-lock.json`.

## GBrain — private memory (per workspace)
- Runtime: Bun >= 1.3.11. Install: `bun install -g github:garrytan/gbrain#latest-stable`. The npm package `gbrain` is unrelated — do not install it.
- Keyless local brain: `gbrain init --pglite --no-embedding` (embedded PGLite; keyword search, responses flag `search_degraded`).
- Isolation: one brain per workspace via absolute `GBRAIN_HOME=/…/data/<ws>/gbrain`; unset `GBRAIN_DATABASE_URL` and `DATABASE_URL`.
- Integration: stdio MCP `gbrain serve --surface verbs` → tools `recall`, `remember`, `entity`, `synthesize`, `forget`, `context_pack`, `delta`.
  - `remember(fact, provenance, entity?, kind?, visibility?, request_id?)` → `{id, status, entity_slug, …}`
  - `recall(query?, entity?, budget_tokens?, source_id?, since?, limit?)` → `{facts[], results[], search_degraded?}`
  - `gbrain protocol --json` prints live schemas.
- Offline embeddings (optional): `OLLAMA_BASE_URL` + `--embedding-model ollama:bge-m3`.

## Memorable — procedure extraction
- API: `https://memorable-extraction-api.memorable.workers.dev`, `Authorization: Bearer mk_…` (key from memorable.sh/dash; human sign-in).
- `POST /v1/extract` body: `{session_id, task_description, harness, skip_embedding, tool_calls:[{name, input:{command|file_path|path|pattern|url|query}, result:{ok}|{exit_code}}]}` → `{draft:{title, steps[], trigger_signature, preconditions, postconditions, …}, request_id}`. A 200 with `refused: "allowance_exhausted"` stored nothing.
- Local store/recall: npm `memorable-cli` (`memorable init`, `memorable enable`, `memorable ingest -`, `memorable recall "<task>"`, `memorable chain --json`, read-only `memorable mcp`).

## QM — evaluation
- Running locally from `qm/` (`npm run dev-instance:web`, core on :8081). FIA evaluation board = QM fork extension using swarms (`qm/docs/swarms.md`).

## River — model training
- Python only: `pip install river-client`; `RIVER_API_KEY=rv_…` (console.river.ai). gRPC to `api.river.ai:443`.
- `client.get_capabilities()`; `with client.session(project=…) as s: m = s.create_model(base_model="Qwen/Qwen3.5-9B", lora=river.LoraConfig(rank=…))`; loop `m.forward_backward(batch, loss_fn="cross_entropy")` + `m.optim_step(lr=…)`; `m.save_weights(name, mode="inference")` → `river://…`.
- Batches are pre-tokenized `{input_ids, target_tokens, weights}` (weights 0 on prompt).
- Adapter download: documented only via Console → Checkpoints (PEFT LoRA). Local load on Apple Silicon: llama.cpp `convert_lora_to_gguf.py` + `llama-server --lora`, or fuse with PEFT → MLX. Neither is River-documented; treat as a gate.

## UFO — investigation workflow
- Hosted client `ufo` (logged in). Programmatic: `ufo --json "msg"` → NDJSON events (`session_start`, `message_sent{turn_id}`, `op_start/op_end`, `authorization_request`, `turn_end`, `exit`); stdin commands `send`, `authorize`, `answer`, `shutdown`.
- Self-host (`ufo-ai/ufo-core`): uv + Python 3.12 + cargo; `make install/build/init/serve` → `http://localhost:8710`. Extensions are Python packages exporting `Manifest(tools=(ToolDef…), models=(ModelSpec…), embeds=(EmbedBackendSpec…))`.
- Local model: copy `extensions/openrouter`, point `base_url` at a local OpenAI-compatible server. Avoid remote embeddings via a local `embeds` backend + `[memory] embed_backend`.
- `ufo-core` ships `extensions/gbrain` (syncs gbrain sources).

## Superset — review
- CLI `~/.superset/bin/superset` (needs `superset auth login` or `SUPERSET_API_KEY`).
- `superset pages publish <dir|file> --title … --label … --visibility just_me|org --page <id> --json`; `pages versions`, `pages comments`, `pages pull`.
