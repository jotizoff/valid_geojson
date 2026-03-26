from __future__ import annotations
import json
from dataclasses import dataclass, field
from typing import Any
from shapely.geometry import shape

@dataclass
class PlanFeature:
    feature_id: str
    layer: str
    properties: dict[str, Any]
    geometry: Any

@dataclass
class Plan:
    name: str
    crs: str | None
    features: list[PlanFeature] = field(default_factory=list)

    def by_layer(self, layer: str) -> list[PlanFeature]:
        return [f for f in self.features if f.layer == layer]

    @property
    def bounds(self) -> tuple[float, float, float, float] | None:
        if not self.features:
            return None
        xs, ys = [], []
        for f in self.features:
            minx, miny, maxx, maxy = f.geometry.bounds
            xs.extend([minx, maxx])
            ys.extend([miny, maxy])
        return min(xs), min(ys), max(xs), max(ys)

def _infer_layer(props: dict[str, Any], geometry_type: str) -> str:
    if props.get("layer"):
        return str(props["layer"])
    fid = str(props.get("id", "")).lower()
    kind = str(props.get("kind", "")).lower()
    use = str(props.get("use", "")).lower()
    if use == "residential" or "building" in fid:
        return "building"
    if "red_line" in fid or "redline" in fid:
        return "red_line"
    if "playground" in fid:
        return "playground"
    if "dog" in fid:
        return "dog_area"
    if "sport" in fid:
        return "sport_area"
    if "parking" in fid:
        return "parking"
    if "industrial" in fid:
        return "industrial"
    if "arch" in fid:
        return "arch"
    if "turnaround" in fid:
        return "turnaround"
    if "green" in fid:
        return "green"
    if "site" in fid:
        return "site_boundary"
    if "path" in fid:
        return "pedestrian_path"
    if kind in {"service", "road", "street", "dead_end"}:
        return "road"
    if kind in {"water", "sewer", "electric", "gas", "heat"}:
        return "network"
    if geometry_type in {"Polygon", "MultiPolygon"}:
        return "building"
    if geometry_type in {"LineString", "MultiLineString"}:
        return "road"
    return "unknown"

def load_plan_from_text(text: str) -> Plan:
    payload = json.loads(text)
    crs = None
    if isinstance(payload.get("crs"), dict):
        crs = payload["crs"].get("properties", {}).get("name")
    features = []
    for idx, raw in enumerate(payload.get("features", []), start=1):
        props = raw.get("properties", {}) or {}
        geom_payload = raw["geometry"]
        layer = _infer_layer(props, geom_payload.get("type", ""))
        feature_id = props.get("id") or raw.get("id") or f"feature_{idx}"
        features.append(
            PlanFeature(
                feature_id=feature_id,
                layer=layer,
                properties={**props, "layer": layer},
                geometry=shape(geom_payload),
            )
        )
    return Plan(name=payload.get("name", "plan"), crs=crs, features=features)
