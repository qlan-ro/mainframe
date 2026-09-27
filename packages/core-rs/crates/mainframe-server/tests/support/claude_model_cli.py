#!/usr/bin/python3
import json
import pathlib
import sys


def emit(value):
    print(json.dumps(value), flush=True)


if "--version" in sys.argv:
    print("2.1.280 (Claude Code)")
    sys.exit(0)

root = pathlib.Path.cwd()
args = sys.argv[1:]
settings = root / "configured-model"
configured = settings.read_text().strip() if settings.exists() else None
inherited = (root / "transcript-model").read_text().strip() if "--resume" in args else configured
requested = args[args.index("--model") + 1] if "--model" in args else inherited
if requested is None:
    sys.exit(1)
aliases = {"opus": "claude-opus-5-5", "default": "claude-opus-5-5"}
model = aliases.get(requested, requested)
with (root / "launches.jsonl").open("a") as log:
    log.write(json.dumps(args) + "\n")

for line in sys.stdin:
    request = json.loads(line)
    if request.get("type") != "control_request":
        continue
    control = request["request"]
    response = {"request_id": request["request_id"], "subtype": "success", "response": {}}
    if control["subtype"] == "get_settings":
        response["response"] = {"applied": {"model": model}}
    elif control["subtype"] == "set_model":
        selected = control["model"]
        if selected == "rejected-model":
            response = {"request_id": request["request_id"], "subtype": "error", "error": "Model unavailable"}
        else:
            model = aliases.get(selected, selected)
    emit({"type": "control_response", "response": response})
