from pydantic import BaseModel

class ValidateRequest(BaseModel):
    plan_geojson_text: str
    rules_yaml_text: str

class BatchPlanItem(BaseModel):
    name: str
    plan_geojson_text: str

class BatchValidateRequest(BaseModel):
    plans: list[BatchPlanItem]
    rules_yaml_text: str
