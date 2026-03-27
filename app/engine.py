from __future__ import annotations
from dataclasses import asdict, dataclass
from typing import Any
from .io_utils import Plan, PlanFeature
from .rules import Rule

@dataclass
class RuleResult:
    rule_id: str
    title: str
    status: str
    severity: str
    reason: str | None
    refs: list[str]
    affected_feature_ids: list[str]
    details: dict[str, Any]

@dataclass
class Violation:
    rule_id: str
    title: str
    severity: str
    feature_ids: list[str]
    value: float | int | str | bool | None
    threshold: float | int | str | bool | None
    message: str
    refs: list[str]
    details: dict[str, Any]

def _plan_layers(plan: Plan) -> set[str]:
    return {f.layer for f in plan.features}

def _matches_filter(feature: PlanFeature, flt: dict[str, Any] | None) -> bool:
    if not flt:
        return True
    for field, expected in flt.items():
        actual = feature.properties.get(field)
        if isinstance(expected, list):
            if actual not in expected:
                return False
        elif actual != expected:
            return False
    return True

def _select_features(plan: Plan, selector: dict[str, Any]) -> list[PlanFeature]:
    layer = selector.get("layer")
    source = plan.by_layer(layer) if layer else plan.features
    return [f for f in source if _matches_filter(f, selector.get("filter"))]

def is_rule_applicable(rule: Rule, plan: Plan) -> bool:
    cond = rule.applies_if or {}
    if not cond:
        return True
    any_layers = cond.get("plan_layers_any")
    all_layers = cond.get("plan_layers_all")
    if any_layers and not (_plan_layers(plan) & set(any_layers)):
        return False
    if all_layers and not set(all_layers).issubset(_plan_layers(plan)):
        return False
    return True

def _distance(a: PlanFeature, b: PlanFeature) -> float:
    return float(a.geometry.distance(b.geometry))

def _classify_below_min(value: float, threshold: float, policy: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    shortfall = max(0.0, float(threshold) - float(value))
    deviation_percent = round((shortfall / float(threshold)) * 100.0, 3) if threshold > 0 else 0.0
    warning_threshold_percent = float(policy.get("warning_threshold_percent", 20.0))
    severity = "warning" if deviation_percent <= warning_threshold_percent else "error"
    return severity, {"direction": "below_min", "shortfall": round(shortfall, 3), "deviation_percent": deviation_percent}

def _classify_above_max(value: float, threshold: float, policy: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    overflow = max(0.0, float(value) - float(threshold))
    deviation_percent = round((overflow / float(threshold)) * 100.0, 3) if threshold > 0 else 0.0
    warning_threshold_percent = float(policy.get("warning_threshold_percent", 20.0))
    severity = "warning" if deviation_percent <= warning_threshold_percent else "error"
    return severity, {"direction": "above_max", "overflow": round(overflow, 3), "deviation_percent": deviation_percent}

def _insufficient(rule: Rule, reason: str, details: dict[str, Any] | None = None):
    return [], RuleResult(rule.rule_id, rule.title, "insufficient_data", "insufficient_data", reason, rule.refs, [], details or {})

def _not_applicable(rule: Rule, reason: str):
    return [], RuleResult(rule.rule_id, rule.title, "not_applicable", "info", reason, rule.refs, [], {})

def _passed(rule: Rule):
    return [], RuleResult(rule.rule_id, rule.title, "passed", "info", None, rule.refs, [], {})

def _failed(rule: Rule, violations: list[Violation]):
    severity = "error" if any(v.severity == "error" for v in violations) else "warning"
    affected = sorted({fid for v in violations for fid in v.feature_ids})
    return violations, RuleResult(rule.rule_id, rule.title, "violated", severity, None, rule.refs, affected, {"violations_count": len(violations)})

def _numeric_attr(item: PlanFeature, field: str):
    value = item.properties.get(field)
    if value is None and field == "length":
        return float(item.geometry.length)
    if value is None and field == "area":
        return float(item.geometry.area)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

def _nearest_valid_target(item: PlanFeature, targets: list[PlanFeature], rule: Rule):
    ignore_if = rule.ignore_if or {}
    skip_intersections = bool(ignore_if.get("intersects", False))
    candidates = sorted(targets, key=lambda other: _distance(item, other))
    for other in candidates:
        if skip_intersections and item.geometry.intersects(other.geometry):
            continue
        return other
    return None

def _check_pair_min_distance(rule: Rule, plan: Plan):
    items = _select_features(plan, rule.scope)
    if len(items) == 0:
        return _not_applicable(rule, "В плане отсутствуют объекты целевого слоя")
    if len(items) < 2:
        return _insufficient(rule, "Недостаточно объектов для парной проверки")
    threshold = float(rule.check["threshold"])
    policy = rule.check.get("severity_policy", {})
    violations = []
    for i, left in enumerate(items):
        for j, right in enumerate(items):
            if j <= i:
                continue
            if rule.ignore_if.get("intersects") and left.geometry.intersects(right.geometry):
                continue
            value = _distance(left, right)
            if value < threshold:
                sev, metrics = _classify_below_min(value, threshold, policy)
                violations.append(Violation(rule.rule_id, rule.title, sev, [left.feature_id, right.feature_id], round(value, 3), threshold, rule.message.get("ru", rule.title), rule.refs, metrics))
    return _failed(rule, violations) if violations else _passed(rule)

def _check_min_distance_to_layer(rule: Rule, plan: Plan):
    scope_items = _select_features(plan, rule.scope)
    target_items = _select_features(plan, rule.check["target"])
    if not scope_items:
        return _not_applicable(rule, "В плане отсутствуют объекты области проверки")
    if not target_items:
        return _not_applicable(rule, "В плане отсутствует целевой слой для сравнения")
    threshold = float(rule.check["threshold"])
    policy = rule.check.get("severity_policy", {})
    violations = []
    for item in scope_items:
        nearest = _nearest_valid_target(item, target_items, rule)
        if nearest is None:
            continue
        value = _distance(item, nearest)
        if value < threshold:
            sev, metrics = _classify_below_min(value, threshold, policy)
            violations.append(Violation(rule.rule_id, rule.title, sev, [item.feature_id, nearest.feature_id], round(value, 3), threshold, rule.message.get("ru", rule.title), rule.refs, metrics))
    return _failed(rule, violations) if violations else _passed(rule)

def _check_max_distance_to_layer(rule: Rule, plan: Plan):
    scope_items = _select_features(plan, rule.scope)
    target_items = _select_features(plan, rule.check["target"])
    if not scope_items:
        return _not_applicable(rule, "В плане отсутствуют объекты области проверки")
    if not target_items:
        return _not_applicable(rule, "В плане отсутствует целевой слой для сравнения")
    threshold = float(rule.check["threshold"])
    policy = rule.check.get("severity_policy", {})
    violations = []
    for item in scope_items:
        nearest = _nearest_valid_target(item, target_items, rule)
        if nearest is None:
            continue
        value = _distance(item, nearest)
        if value > threshold:
            sev, metrics = _classify_above_max(value, threshold, policy)
            violations.append(Violation(rule.rule_id, rule.title, sev, [item.feature_id, nearest.feature_id], round(value, 3), threshold, rule.message.get("ru", rule.title), rule.refs, metrics))
    return _failed(rule, violations) if violations else _passed(rule)

def _check_attribute_min(rule: Rule, plan: Plan):
    items = _select_features(plan, rule.scope)
    if not items:
        return _not_applicable(rule, "В плане отсутствуют объекты целевого слоя")
    field = rule.check["field"]
    threshold = float(rule.check["threshold"])
    policy = rule.check.get("severity_policy", {})
    violations, missing = [], []
    for item in items:
        value = _numeric_attr(item, field)
        if value is None:
            missing.append(item.feature_id)
            continue
        if value < threshold:
            sev, metrics = _classify_below_min(value, threshold, policy)
            violations.append(Violation(rule.rule_id, rule.title, sev, [item.feature_id], round(value, 3), threshold, rule.message.get("ru", rule.title), rule.refs, {"field": field, **metrics}))
    if missing and not violations:
        return _insufficient(rule, f"Не хватает атрибута {field}")
    return _failed(rule, violations) if violations else _passed(rule)

def _check_attribute_max(rule: Rule, plan: Plan):
    items = _select_features(plan, rule.scope)
    if not items:
        return _not_applicable(rule, "В плане отсутствуют объекты целевого слоя")
    field = rule.check["field"]
    threshold = float(rule.check["threshold"])
    policy = rule.check.get("severity_policy", {})
    violations, missing = [], []
    for item in items:
        value = _numeric_attr(item, field)
        if value is None:
            missing.append(item.feature_id)
            continue
        if value > threshold:
            sev, metrics = _classify_above_max(value, threshold, policy)
            violations.append(Violation(rule.rule_id, rule.title, sev, [item.feature_id], round(value, 3), threshold, rule.message.get("ru", rule.title), rule.refs, {"field": field, **metrics}))
    if missing and not violations:
        return _insufficient(rule, f"Не хватает атрибута {field}")
    return _failed(rule, violations) if violations else _passed(rule)

def _check_area_min(rule: Rule, plan: Plan):
    items = _select_features(plan, rule.scope)
    if not items:
        return _not_applicable(rule, "В плане отсутствуют объекты целевого слоя")
    threshold = float(rule.check["threshold"])
    policy = rule.check.get("severity_policy", {})
    violations = []
    for item in items:
        value = float(item.geometry.area)
        if value < threshold:
            sev, metrics = _classify_below_min(value, threshold, policy)
            violations.append(Violation(rule.rule_id, rule.title, sev, [item.feature_id], round(value, 3), threshold, rule.message.get("ru", rule.title), rule.refs, {"field": "area", **metrics}))
    return _failed(rule, violations) if violations else _passed(rule)

def _check_area_ratio_min(rule: Rule, plan: Plan):
    scope_items = _select_features(plan, rule.scope)
    target_items = _select_features(plan, rule.check["target"])
    if not scope_items:
        return _not_applicable(rule, "В плане отсутствуют объекты числителя для расчета доли")
    if not target_items:
        return _not_applicable(rule, "В плане отсутствует базовая территория для расчета доли")
    base_area = sum(float(x.geometry.area) for x in target_items)
    if base_area <= 0:
        return _insufficient(rule, "Некорректная площадь базовой территории")
    value = sum(float(x.geometry.area) for x in scope_items) / base_area
    threshold = float(rule.check["threshold"])
    policy = rule.check.get("severity_policy", {})
    if value < threshold:
        sev, metrics = _classify_below_min(value, threshold, policy)
        v = Violation(rule.rule_id, rule.title, sev, [x.feature_id for x in scope_items], round(value, 4), threshold, rule.message.get("ru", rule.title), rule.refs, {"field": "area_ratio", **metrics})
        return _failed(rule, [v])
    return _passed(rule)

def _check_range_distance_to_layer(rule: Rule, plan: Plan):
    scope_items = _select_features(plan, rule.scope)
    target_items = _select_features(plan, rule.check["target"])
    if not scope_items:
        return _not_applicable(rule, "В плане отсутствуют объекты области проверки")
    if not target_items:
        return _not_applicable(rule, "В плане отсутствует целевой слой для сравнения")
    min_t = float(rule.check["min"]); max_t = float(rule.check["max"])
    policy = rule.check.get("severity_policy", {})
    violations = []
    for item in scope_items:
        nearest = _nearest_valid_target(item, target_items, rule)
        if nearest is None:
            continue
        value = _distance(item, nearest)
        if value < min_t:
            sev, metrics = _classify_below_min(value, min_t, policy)
            violations.append(Violation(rule.rule_id, rule.title, sev, [item.feature_id, nearest.feature_id], round(value, 3), f"{min_t}..{max_t}", rule.message.get("ru", rule.title), rule.refs, {"range_side": "below", **metrics}))
        elif value > max_t:
            sev, metrics = _classify_above_max(value, max_t, policy)
            violations.append(Violation(rule.rule_id, rule.title, sev, [item.feature_id, nearest.feature_id], round(value, 3), f"{min_t}..{max_t}", rule.message.get("ru", rule.title), rule.refs, {"range_side": "above", **metrics}))
    return _failed(rule, violations) if violations else _passed(rule)

def _check_max_distance_between_features(rule: Rule, plan: Plan):
    items = _select_features(plan, rule.scope)
    if len(items) == 0:
        return _not_applicable(rule, "В плане отсутствуют объекты целевого слоя")
    if len(items) < 2:
        return _insufficient(rule, "Недостаточно объектов для проверки расстояния")
    threshold = float(rule.check["threshold"])
    policy = rule.check.get("severity_policy", {})
    violations = []
    for item in items:
        others = [x for x in items if x.feature_id != item.feature_id]
        filtered = []
        for other in others:
            if rule.ignore_if.get("intersects") and item.geometry.intersects(other.geometry):
                continue
            filtered.append(other)
        if not filtered:
            continue
        nearest = min(filtered, key=lambda other: _distance(item, other))
        value = _distance(item, nearest)
        if value > threshold:
            sev, metrics = _classify_above_max(value, threshold, policy)
            pair = sorted([item.feature_id, nearest.feature_id])
            violations.append(Violation(rule.rule_id, rule.title, sev, pair, round(value, 3), threshold, rule.message.get("ru", rule.title), rule.refs, metrics))
    dedup, seen = [], set()
    for v in violations:
        key = tuple(v.feature_ids)
        if key not in seen:
            seen.add(key)
            dedup.append(v)
    return _failed(rule, dedup) if dedup else _passed(rule)

def validate_plan(plan: Plan, rules: list[Rule]) -> dict[str, Any]:
    applicable = [r for r in rules if r.status == "active" and is_rule_applicable(r, plan)]
    violations, rule_results = [], []
    for rule in applicable:
        t = rule.check.get("type")
        if t == "pair_min_distance":
            v, rr = _check_pair_min_distance(rule, plan)
        elif t == "min_distance_to_layer":
            v, rr = _check_min_distance_to_layer(rule, plan)
        elif t == "max_distance_to_layer":
            v, rr = _check_max_distance_to_layer(rule, plan)
        elif t == "attribute_min":
            v, rr = _check_attribute_min(rule, plan)
        elif t == "attribute_max":
            v, rr = _check_attribute_max(rule, plan)
        elif t == "area_min":
            v, rr = _check_area_min(rule, plan)
        elif t == "area_ratio_min":
            v, rr = _check_area_ratio_min(rule, plan)
        elif t == "range_distance_to_layer":
            v, rr = _check_range_distance_to_layer(rule, plan)
        elif t == "max_distance_between_features":
            v, rr = _check_max_distance_between_features(rule, plan)
        else:
            v, rr = [], RuleResult(rule.rule_id, rule.title, "insufficient_data", "insufficient_data", f"Неизвестный тип проверки: {t}", rule.refs, [], {})
        violations.extend(v)
        rule_results.append(rr)
    return {
        "plan_name": plan.name,
        "applicable_rules": [r.rule_id for r in applicable],
        "layers": sorted(list(_plan_layers(plan))),
        "summary": {
            "warnings": len([x for x in violations if x.severity == "warning"]),
            "errors": len([x for x in violations if x.severity == "error"]),
            "insufficient_data": len([x for x in rule_results if x.status == "insufficient_data"]),
            "not_applicable": len([x for x in rule_results if x.status == "not_applicable"]),
            "passed": len([x for x in rule_results if x.status == "passed"]),
            "violated_rules": len([x for x in rule_results if x.status == "violated"]),
        },
        "rule_results": [asdict(x) for x in rule_results],
        "violations": [asdict(v) for v in violations],
    }
