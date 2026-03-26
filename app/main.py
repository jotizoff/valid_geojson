from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from .engine import validate_plan
from .io_utils import load_plan_from_text
from .models import ValidateRequest, BatchValidateRequest
from .rules import load_rules_from_directory, dump_rules_to_yaml, parse_rules_yaml

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
RULES_DIR = DATA_DIR / "rules"

app = FastAPI(title="Urban Plan IDE UI", version="6.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

@app.get("/")
def index():
    return FileResponse(BASE_DIR / "templates" / "index.html")

@app.get("/api/demo")
def api_demo():
    demo_plan = (DATA_DIR / "plans" / "mixed_status_plan.geojson").read_text(encoding="utf-8")
    rules_text = dump_rules_to_yaml(load_rules_from_directory(RULES_DIR))
    return {"plan_geojson_text": demo_plan, "rules_yaml_text": rules_text}

@app.post("/api/validate")
def api_validate(payload: ValidateRequest):
    try:
        plan = load_plan_from_text(payload.plan_geojson_text)
        rules = parse_rules_yaml(payload.rules_yaml_text)
        return JSONResponse(validate_plan(plan, rules))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@app.post("/api/batch-validate")
def api_batch_validate(payload: BatchValidateRequest):
    try:
        rules = parse_rules_yaml(payload.rules_yaml_text)
        reports = []
        for item in payload.plans:
            plan = load_plan_from_text(item.plan_geojson_text)
            report = validate_plan(plan, rules)
            reports.append({"input_name": item.name, **report})
        return JSONResponse({"reports": reports})
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
