import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path

BASE_MODEL = "Qwen/Qwen3.5-9B"
TOKENIZER_REVISION = "c202236235762e1c871ad0ccb60c8ee5ba337b9a"
HERE = Path(__file__).resolve().parent


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def client():
    import river_client as river

    key = os.environ.get("RIVER_API_KEY")
    if not key:
        raise SystemExit(json.dumps({"ok": False, "error": "RIVER_API_KEY not set"}))
    return river.Client(api_key=key, endpoint=os.environ.get("RIVER_ENDPOINT", "api.river.ai"))


def tokenizer():
    import river_client as river

    return river.load_tokenizer(base_model=BASE_MODEL, revision=TOKENIZER_REVISION)


def cmd_capabilities(_args):
    c = client()
    caps = c.get_server_capabilities()
    c.close()
    emit({
        "ok": True,
        "checked_at": now(),
        "supported_models": list(caps.supported_models),
        "features": sorted(caps.features),
        "base_model": BASE_MODEL,
        "base_model_supported": BASE_MODEL in caps.supported_models,
        "base_model_features": sorted(caps.model_features.get(BASE_MODEL, [])),
    })


def cmd_build_dataset(args):
    from river_client.renderers import TrainOnWhat, get_renderer

    src = Path(args.rendered)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tok = tokenizer()
    renderer = get_renderer(BASE_MODEL, tokenizer=tok, thinking=False)
    rows = [json.loads(l) for l in src.read_text().splitlines() if l.strip()]
    total_tokens = 0
    trained_tokens = 0
    ids = []
    with open(out / "dataset.jsonl", "w") as f:
        for row in rows:
            datum = renderer.build_training_example(row["messages"], train_on=TrainOnWhat.LAST_ASSISTANT).to_dict()
            n = sum(len(ch.get("tokens", [])) for ch in datum["model_input"])
            total_tokens += n
            trained_tokens += sum(1 for w in datum["weights"] if w > 0)
            ids.append(row["id"])
            f.write(json.dumps({"id": row["id"], "datum": datum}, separators=(",", ":")) + "\n")
    manifest = {
        "built_at": now(),
        "base_model": BASE_MODEL,
        "tokenizer": {"name": BASE_MODEL, "revision": TOKENIZER_REVISION, "class": type(tok).__name__, "thinking": False},
        "renderer": "river_client.renderers.get_renderer(train_on=LAST_ASSISTANT)",
        "source": {"file": src.name, "sha256": sha256_file(src)},
        "dataset": {"file": "dataset.jsonl", "sha256": sha256_file(out / "dataset.jsonl"), "examples": len(rows), "tokens": total_tokens, "trained_positions": trained_tokens},
        "case_ids": ids,
    }
    (out / "dataset-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    emit({"ok": True, **manifest})


def cmd_train(args):
    import river_client as river

    ds_dir = Path(args.dataset_dir)
    run_dir = Path(args.out)
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ds_dir / "dataset-manifest.json").read_text())
    if sha256_file(ds_dir / "dataset.jsonl") != manifest["dataset"]["sha256"]:
        raise SystemExit(json.dumps({"ok": False, "error": "dataset hash mismatch"}))
    rows = [json.loads(l) for l in (ds_dir / "dataset.jsonl").read_text().splitlines() if l.strip()]
    data = [r["datum"] for r in rows]
    source = ds_dir / manifest["source"]["file"]
    result = {"ok": False, "started_at": now(), "base_model": BASE_MODEL, "dataset_sha256": manifest["dataset"]["sha256"], "source_sha256": manifest["source"]["sha256"], "config": {"rank": args.rank, "lr": args.lr, "steps": args.steps, "batch_size": args.batch, "loss_fn": "cross_entropy", "seed": args.seed}, "steps": []}

    def save():
        (run_dir / "result.json").write_text(json.dumps(result, indent=2) + "\n")

    save()
    c = client()
    try:
        caps = c.get_server_capabilities()
        result["capabilities"] = {"base_model_supported": BASE_MODEL in caps.supported_models, "supported_models": list(caps.supported_models)}
        if BASE_MODEL not in caps.supported_models:
            raise RuntimeError(f"{BASE_MODEL} is not available to this River account")
        emit({"event": "capabilities", "base_model_supported": True})
        tok = tokenizer()
        with c.session(project="fia-harbor", stage="training", run=args.name) as session:
            result["session_id"] = session.session_id
            emit({"event": "session", "session_id": session.session_id})
            attestation = session.attest_training_data([
                river.TrainingDataArtifact(name=source.name, expected_sha256=manifest["source"]["sha256"], content=source.read_bytes()),
                river.TrainingDataArtifact(name="dataset.jsonl", expected_sha256=manifest["dataset"]["sha256"], content=(ds_dir / "dataset.jsonl").read_bytes()),
            ])
            result["attestation"] = {"id": attestation.training_data_attestation_id, "artifacts": [{"name": a.name, "sha256": a.sha256, "size_bytes": a.size_bytes} for a in attestation.artifacts]}
            emit({"event": "attested", "attestation_id": attestation.training_data_attestation_id})
            save()
            model = session.create_model(base_model=BASE_MODEL, lora=river.LoraConfig(rank=args.rank, seed=args.seed), tokenizer=tok, training_data_attestation=attestation)
            result["training_run_id"] = model.training_run_id
            emit({"event": "model", "training_run_id": model.training_run_id})
            save()
            n = len(data)
            for step in range(args.steps):
                start = (step * args.batch) % n
                batch = [data[(start + i) % n] for i in range(args.batch)]
                t0 = time.time()
                fb = model.forward_backward(batch, loss_fn="cross_entropy")
                opt = model.optim_step(lr=args.lr, grad_clip_norm=1.0)
                entry = {"step": step + 1, "at": now(), "examples": len(batch), "loss_mean": fb.metrics.get("loss_mean"), "loss_sum": fb.metrics.get("loss_sum"), "num_tokens": fb.metrics.get("num_tokens"), "grad_norm": opt.metrics.get("grad_norm") if getattr(opt, "metrics", None) else None, "seconds": round(time.time() - t0, 2)}
                result["steps"].append(entry)
                emit({"event": "step", **entry})
                save()
            ckpt = model.save_weights(args.name, mode="inference")
            result["checkpoint"] = {"path": ckpt.path, "step": ckpt.step, "type": ckpt.checkpoint_type, "format": "PEFT LoRA (inference mode)"}
            emit({"event": "checkpoint", "path": ckpt.path, "step": ckpt.step})
        result["ok"] = True
    except Exception as err:
        result["error"] = f"{type(err).__name__}: {str(err)[:800]}"
        emit({"event": "error", "error": result["error"]})
    finally:
        result["finished_at"] = now()
        save()
        c.close()
    emit({"ok": result["ok"], "result": str(run_dir / "result.json")})


def cmd_convert(args):
    script = HERE / "vendor" / "llama.cpp" / "convert_lora_to_gguf.py"
    if not script.exists():
        emit({"ok": False, "error": f"llama.cpp converter not present at {script}"})
        return
    snap = Path.home() / ".cache" / "huggingface" / "hub" / "models--Qwen--Qwen3.5-9B" / "snapshots" / TOKENIZER_REVISION
    if not (snap / "config.json").exists():
        tokenizer()
    out = Path(args.outfile)
    proc = subprocess.run([sys.executable, str(script), "--base", str(snap), "--outfile", str(out), "--outtype", "f16", args.adapter_dir], capture_output=True, text=True, timeout=1800)
    tail = (proc.stdout + proc.stderr)[-2000:]
    if proc.returncode != 0 or not out.exists():
        emit({"ok": False, "error": f"convert_lora_to_gguf.py exited {proc.returncode}", "log_tail": tail})
        return
    emit({"ok": True, "gguf": str(out), "sha256": sha256_file(out), "bytes": out.stat().st_size, "log_tail": tail[-600:]})


def main():
    p = argparse.ArgumentParser(prog="fia-river-sidecar")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("capabilities")
    b = sub.add_parser("build-dataset")
    b.add_argument("--rendered", required=True)
    b.add_argument("--out", required=True)
    t = sub.add_parser("train")
    t.add_argument("--dataset-dir", required=True)
    t.add_argument("--out", required=True)
    t.add_argument("--name", required=True)
    t.add_argument("--steps", type=int, default=10)
    t.add_argument("--batch", type=int, default=12)
    t.add_argument("--rank", type=int, default=16)
    t.add_argument("--lr", type=float, default=1e-4)
    t.add_argument("--seed", type=int, default=7)
    cv = sub.add_parser("convert")
    cv.add_argument("--adapter-dir", required=True)
    cv.add_argument("--outfile", required=True)
    args = p.parse_args()
    try:
        {"capabilities": cmd_capabilities, "build-dataset": cmd_build_dataset, "train": cmd_train, "convert": cmd_convert}[args.cmd](args)
    except SystemExit:
        raise
    except Exception as err:
        emit({"ok": False, "error": f"{type(err).__name__}: {str(err)[:800]}", "trace": traceback.format_exc()[-1200:]})
        sys.exit(1)


if __name__ == "__main__":
    main()
