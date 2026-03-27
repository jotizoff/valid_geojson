from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
import yaml

@dataclass
class Rule:
    rule_id: str
    title: str
    severity: str
    refs: list[str]
    status: str
    applies_if: dict[str, Any]
    scope: dict[str, Any]
    check: dict[str, Any]
    message: dict[str, str]
    ignore_if: dict[str, Any] = field(default_factory=dict)
    meta: dict[str, Any] = field(default_factory=dict)

def _normalize_rule(item: dict[str, Any]) -> Rule:
    return Rule(
        rule_id=item["id"],
        title=item.get("title", item["id"]),
        severity=item.get("severity", "warning"),
        refs=item.get("refs", []),
        status=item.get("status", "active"),
        applies_if=item.get("applies_if", {}),
        scope=item.get("scope", {}),
        check=item.get("check", {}),
        message=item.get("message", {"ru": item.get("title", item["id"])}),
        ignore_if=item.get("ignore_if", {}),
        meta=item.get("meta", {}),
    )

def parse_rules_yaml(text: str) -> list[Rule]:
    payload = yaml.safe_load(text)
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        raise ValueError("Rules YAML must be a list of rule objects")
    return [_normalize_rule(item) for item in payload]

def load_rules_from_directory(directory: str | Path) -> list[Rule]:
    directory = Path(directory)
    rules: list[Rule] = []
    for path in sorted(directory.glob("*.yaml")):
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            payload = [payload]
        if not isinstance(payload, list):
            continue
        rules.extend(_normalize_rule(item) for item in payload)
    return rules

def dump_rules_to_yaml(rules: list[Rule]) -> str:
    raw = []
    for r in rules:
        raw.append({
            "id": r.rule_id,
            "title": r.title,
            "severity": r.severity,
            "status": r.status,
            "refs": r.refs,
            "applies_if": r.applies_if,
            "scope": r.scope,
            "check": r.check,
            "message": r.message,
            "ignore_if": r.ignore_if,
            "meta": r.meta,
        })
    return yaml.safe_dump(raw, allow_unicode=True, sort_keys=False)
