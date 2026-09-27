import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import river_client as river
from river_client._proto import river_pb2 as pb2

BASE_MODEL = os.environ.get("RIVER_BASE_MODEL", "Qwen/Qwen3.5-9B")
MODEL_ALIASES = {BASE_MODEL, "qwen3.5:9b", "qwen3.5-9b", "default", ""}
ENDPOINT = os.environ.get("RIVER_ENDPOINT", "api.river.ai")
HOST = os.environ.get("RIVER_SHIM_HOST", "127.0.0.1")
PORT = int(os.environ.get("RIVER_SHIM_PORT", "7110"))
TIMEOUT = float(os.environ.get("RIVER_SHIM_TIMEOUT", "300"))
STARTED = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

state = {"client": None, "capabilities": None, "error": None, "requests": 0, "failures": 0, "last_request_id": None}
lock = threading.Lock()


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def log(msg):
    sys.stderr.write(f"[river-shim] {now()} {msg}\n")
    sys.stderr.flush()


def client():
    with lock:
        if state["client"] is None:
            key = os.environ.get("RIVER_API_KEY")
            if not key:
                raise RuntimeError("RIVER_API_KEY not set")
            state["client"] = river.Client(api_key=key, endpoint=ENDPOINT)
        return state["client"]


def discover():
    try:
        caps = client().get_server_capabilities()
        state["capabilities"] = {
            "checked_at": now(),
            "base_model_supported": BASE_MODEL in caps.supported_models,
            "supported_models": list(caps.supported_models),
            "model_features": sorted(caps.model_features.get(BASE_MODEL, [])),
        }
        state["error"] = None if BASE_MODEL in caps.supported_models else f"{BASE_MODEL} not available to this River account"
    except Exception as err:
        state["error"] = f"{type(err).__name__}: {err}"
    return state["capabilities"]


def chat(body):
    c = client()
    checkpoint = body.pop("checkpoint", None) or body.pop("river_checkpoint", None)
    requested = body.pop("model", None) or ""
    if not checkpoint and requested.startswith("river://"):
        checkpoint = requested
    elif requested not in MODEL_ALIASES and not checkpoint:
        raise ValueError(f"unsupported model {requested!r}; this shim serves {BASE_MODEL} (or pass checkpoint=river://...)")
    body.pop("stream", None)
    if "chat_template_kwargs" not in body:
        body["chat_template_kwargs"] = {"enable_thinking": bool(body.pop("thinking", False))}
    else:
        body.pop("thinking", None)
    body["model"] = BASE_MODEL
    if checkpoint:
        req = pb2.ChatCompleteFromCheckpointRequest(checkpoint_path=checkpoint, base_model=BASE_MODEL, request_json=json.dumps(body))
        submit = lambda: c._get_stub().ChatCompleteFromCheckpoint(req, metadata=c._get_metadata())
    else:
        req = pb2.ChatCompleteFromBaseRequest(base_model=BASE_MODEL, request_json=json.dumps(body))
        submit = lambda: c._get_stub().ChatCompleteFromBase(req, metadata=c._get_metadata())
    started = time.time()
    response = c._rpc_with_retry(submit, context="FIA shim chat completion")
    request_id = response.request_id
    result = c._wait_for_future(request_id, timeout=TIMEOUT)
    if result.WhichOneof("response") != "chat_complete":
        raise RuntimeError(f"unexpected River response type {result.WhichOneof('response')}")
    status = result.chat_complete.status_code
    try:
        payload = json.loads(result.chat_complete.response_json)
    except json.JSONDecodeError:
        payload = {"error": {"message": result.chat_complete.response_json[:500]}}
    payload["river_request_id"] = request_id
    payload["river_route"] = "checkpoint" if checkpoint else "base"
    payload["river_base_model"] = BASE_MODEL
    payload["river_checkpoint"] = checkpoint
    payload["river_elapsed_ms"] = int((time.time() - started) * 1000)
    state["last_request_id"] = request_id
    return status, payload


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            caps = state["capabilities"] or discover()
            ok = bool(caps and caps["base_model_supported"]) and not state["error"]
            return self.reply(200 if ok else 503, {
                "ok": ok,
                "service": "fia-river-inference-shim",
                "base_model": BASE_MODEL,
                "endpoint": ENDPOINT,
                "river_client": river.__version__,
                "key_configured": bool(os.environ.get("RIVER_API_KEY")),
                "capabilities": caps,
                "error": state["error"],
                "started_at": STARTED,
                "requests": state["requests"],
                "failures": state["failures"],
                "last_request_id": state["last_request_id"],
            })
        if self.path == "/v1/models":
            return self.reply(200, {"object": "list", "data": [{"id": BASE_MODEL, "object": "model", "owned_by": "river"}]})
        return self.reply(404, {"error": {"message": "not found"}})

    def do_POST(self):
        if self.path not in ("/v1/chat/completions", "/chat/completions"):
            return self.reply(404, {"error": {"message": "not found"}})
        try:
            length = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body.get("messages"), list) or not body["messages"]:
                return self.reply(400, {"error": {"message": "messages must be a non-empty list"}})
        except (ValueError, json.JSONDecodeError):
            return self.reply(400, {"error": {"message": "invalid JSON body"}})
        state["requests"] += 1
        try:
            status, payload = chat(body)
            log(f"chat {payload['river_route']} status={status} request_id={payload['river_request_id']} ms={payload['river_elapsed_ms']} usage={json.dumps(payload.get('usage', {}).get('total_tokens'))}")
            if status >= 400:
                state["failures"] += 1
            return self.reply(200 if status < 400 else 502, payload if status < 400 else {"error": {"message": f"River backend returned {status}", "backend": payload}, "river_request_id": payload["river_request_id"]})
        except ValueError as err:
            state["failures"] += 1
            return self.reply(400, {"error": {"message": str(err)}})
        except river.AuthenticationError as err:
            state["failures"] += 1
            log(f"auth failure {type(err).__name__}")
            return self.reply(401, {"error": {"message": "River authentication failed (check RIVER_API_KEY)"}})
        except river.RiverTimeoutError as err:
            state["failures"] += 1
            return self.reply(504, {"error": {"message": f"River timed out: {err}"}, "river_request_id": getattr(err, "request_id", None)})
        except Exception as err:
            state["failures"] += 1
            log(f"failure {type(err).__name__}: {str(err)[:300]}")
            return self.reply(503 if str(err) == "RIVER_API_KEY not set" else 502, {"error": {"message": f"{type(err).__name__}: {str(err)[:500]}"}})


def main():
    if not os.environ.get("RIVER_API_KEY"):
        log("RIVER_API_KEY not set; /health will report blocked and completions return 503")
    else:
        discover()
        log(f"capabilities: base_model_supported={bool(state['capabilities'] and state['capabilities']['base_model_supported'])} error={state['error']}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log(f"listening on http://{HOST}:{PORT} base_model={BASE_MODEL}")
    server.serve_forever()


if __name__ == "__main__":
    main()
