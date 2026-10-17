"""Private stdio compatibility controller for the installed Chrome bridge.

Only connected upload roots are readable. Content never enters model context or
logs. Chrome still performs its normal per-action site permission checks.
"""
import argparse
import base64
import json
import mimetypes
import os
from pathlib import Path
import subprocess
import sys
import threading

MAX_UPLOAD = 10_000_000


def upload_payload(arguments, roots):
    if not isinstance(arguments, dict) or set(arguments) != {"paths", "ref", "tabId"}:
        raise ValueError("Upload requires paths, ref and tabId; file contents come only from connected folders.")
    paths, ref, tab = arguments["paths"], arguments["ref"], arguments["tabId"]
    if not isinstance(paths, list) or not 1 <= len(paths) <= 10 or not all(isinstance(p, str) for p in paths):
        raise ValueError("Provide between one and ten absolute upload paths.")
    if not isinstance(ref, str) or not ref or type(tab) is not int or tab < 0:
        raise ValueError("Upload requires an observed file input ref and tab ID.")
    connected = [Path(root).resolve(strict=True) for root in roots if Path(root).is_dir()]
    files, total = [], 0
    for name in paths:
        requested = Path(name)
        if not requested.is_absolute():
            raise ValueError("Upload paths must be absolute.")
        path = requested.resolve(strict=True)
        if not any(path.is_relative_to(root) for root in connected) or not path.is_file():
            raise ValueError("File is outside the connected upload folders. Ask the user to share it.")
        size = path.stat().st_size
        total += size
        if total >= MAX_UPLOAD:
            raise ValueError("Combined upload size must be under 10 MB.")
        # Bounded read also catches files growing after the size check.
        with path.open("rb") as source:
            data = source.read(MAX_UPLOAD)
        if len(data) != size:
            raise ValueError("Upload file changed while being read; inspect it before retrying.")
        files.append({"name": path.name, "data": base64.b64encode(data).decode("ascii"),
                      "mimeType": mimetypes.guess_type(path.name)[0] or "application/octet-stream"})
    return {"files": files, "ref": ref, "tabId": tab}, total


def transform_call(name, arguments, roots, allowed):
    if name not in allowed:
        raise ValueError("This browser tool is not enabled for the worker.")
    if name == "file_upload":
        payload, _ = upload_payload(arguments, roots)
        return "browser_batch", {"actions": [{"name": "file_upload", "input": payload}]}
    if name == "browser_batch":
        if not isinstance(arguments, dict) or set(arguments) != {"actions"}:
            raise ValueError("Invalid browser batch.")
        actions = arguments["actions"]
        if not isinstance(actions, list) or not 1 <= len(actions) <= 100:
            raise ValueError("Browser batch must contain one to 100 actions.")
        translated, total = [], 0
        for action in actions:
            if not isinstance(action, dict) or set(action) != {"name", "input"}:
                raise ValueError("Invalid browser action.")
            tool, data = action["name"], action["input"]
            if tool == "browser_batch" or tool not in allowed or not isinstance(data, dict):
                raise ValueError("Nested or disabled browser action.")
            if tool == "file_upload":
                data, size = upload_payload(data, roots)
                total += size
                if total >= MAX_UPLOAD:
                    raise ValueError("Combined batch upload size must be under 10 MB.")
            translated.append({"name": tool, "input": data})
        return name, {"actions": translated}
    return name, arguments


def run_bridge(command, roots, allowed):
    env = os.environ.copy()
    for key in ("CLAUDE_CODE_OAUTH_TOKEN", "PC_WORKER_TOKEN"):
        env.pop(key, None)
    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=sys.stderr, text=True, encoding="utf-8", env=env,
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    pending, lock, stopping = {}, threading.Lock(), threading.Event()

    def emit(value):
        with lock:
            sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
            sys.stdout.flush()

    def responses():
        for line in child.stdout:
            try:
                value = json.loads(line)
                method = pending.pop(value.get("id"), None)
                if method == "tools/list" and "result" in value:
                    value["result"]["tools"] = [t for t in value["result"].get("tools", []) if t.get("name") in allowed]
                emit(value)
            except (ValueError, TypeError):
                continue
        if not stopping.is_set():
            os._exit(1)

    reader = threading.Thread(target=responses, daemon=True)
    reader.start()
    try:
        for line in sys.stdin:
            value = None
            try:
                value = json.loads(line)
                if value.get("method") == "tools/call":
                    params = value["params"]
                    name, arguments = transform_call(params["name"], params.get("arguments", {}), roots, allowed)
                    value = {**value, "params": {**params, "name": name, "arguments": arguments}}
                if "id" in value:
                    pending[value["id"]] = value.get("method")
                child.stdin.write(json.dumps(value, separators=(",", ":")) + "\n")
                child.stdin.flush()
            except (ValueError, TypeError, KeyError, OSError) as error:
                if isinstance(value, dict) and "id" in value:
                    emit({"jsonrpc": "2.0", "id": value["id"], "result": {"isError": True,
                          "content": [{"type": "text", "text": "Chrome controller: " + str(error)}]}})
    finally:
        stopping.set()
        child.stdin.close()
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.terminate()
            child.wait(timeout=3)
        reader.join(timeout=1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--claude-bin", required=True)
    parser.add_argument("--upload-root", action="append", default=[])
    parser.add_argument("--enabled-tools", required=True)
    options = parser.parse_args()
    run_bridge([options.claude_bin, "--claude-in-chrome-mcp"], options.upload_root, set(json.loads(options.enabled_tools)))
