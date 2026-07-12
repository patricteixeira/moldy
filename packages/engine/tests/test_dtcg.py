import json
import pytest
from brand_runtime.intake.dtcg import DtcgError, load_dtcg

TOKENS = {
    "color": {
        "brand": {"$type": "color", "$value": "#1A4D8F"},
        "action": {"$type": "color", "$value": "{color.brand}"},
    }
}


def test_alias_resolution(tmp_path):
    p = tmp_path / "tokens.json"
    p.write_text(json.dumps(TOKENS), encoding="utf-8")
    out = load_dtcg(p)
    assert out["color.action"].value == "#1A4D8F"
    assert out["color.action"].evidence[0].source_type == "dtcg-tokens"


def test_cycle_raises(tmp_path):
    cyc = {"color": {"a": {"$type": "color", "$value": "{color.b}"},
                     "b": {"$type": "color", "$value": "{color.a}"}}}
    p = tmp_path / "tokens.json"
    p.write_text(json.dumps(cyc), encoding="utf-8")
    with pytest.raises(DtcgError):
        load_dtcg(p)


def test_draft_ranks_dtcg_first(brand_package, tmp_path):
    from brand_runtime.intake.draft import build_draft
    (brand_package / "tokens.json").write_text(
        json.dumps({"color": {"brand": {"$type": "color", "$value": "#00FF88"}}}),
        encoding="utf-8")
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "color.primary")
    assert q.candidates[0].value == "#00FF88"
