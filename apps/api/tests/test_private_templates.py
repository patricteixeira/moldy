import json

import pytest

from brand_api.models import BrandRevision
from brand_api.private_templates import (
    PRIVATE_TEMPLATE_DIR_ENV,
    PrivateTemplateCatalogError,
    private_template_layouts,
)
from brand_api.revision_ir import revision_brand_ir
from brand_runtime import generate_template_layouts


def _revision(client, compiled) -> BrandRevision:
    with client.app.state.session_factory() as session:
        revision = session.get(BrandRevision, compiled["brandRevisionId"])
        assert revision is not None
        session.expunge(revision)
        return revision


def _private_package(revision: BrandRevision, package_id="impacto-editorial"):
    ir = revision_brand_ir(revision)
    source = generate_template_layouts(ir)[0]
    composition_id = f"{package_id}-cover-post-4x5"
    assert source.template_ref is not None
    layout = source.model_copy(
        update={
            "id": composition_id,
            "name_pt": "Abertura de impacto",
            "template_ref": source.template_ref.model_copy(
                update={
                    "package_id": package_id,
                    "version": "1.0.0",
                    "composition_id": composition_id,
                }
            ),
        }
    )
    return {
        "schemaVersion": "1.0.0",
        "id": package_id,
        "version": "1.0.0",
        "family": "Impacto editorial",
        "titlePt": "Impacto editorial",
        "descriptionPt": "Composições autorais da instância hospedada.",
        "sceneSchemaVersion": "2.0.0",
        "profiles": [layout.profile],
        "requiredRoles": list(ir.roles),
        "requiredColorTokens": ["color.background", "color.text", "color.primary"],
        "compositions": [
            {
                "id": composition_id,
                "namePt": "Abertura de impacto",
                "intentPt": "Abrir uma mensagem com hierarquia direta.",
                "layout": layout.model_dump(mode="json", by_alias=True),
                "sampleContentPt": {
                    slot.id: "Exemplo" for slot in layout.slots if slot.kind != "logo"
                },
                "criticalNodes": ["headline", "logo"],
                "allowedOverlaps": [],
                "exportSupport": {
                    "preview": "native",
                    "png": "native",
                    "pdf": "native",
                    "pptx": "hybrid",
                },
            }
        ],
        "evaluations": [
            {"kind": "no-overflow", "stage": "renderer"},
            {"kind": "safe-area", "stage": "portable"},
            {"kind": "contrast", "stage": "guard"},
            {"kind": "type-hierarchy", "stage": "portable", "minimum": 2.5},
            {
                "kind": "negative-space",
                "stage": "portable",
                "minimum": 0.1,
                "maximum": 0.8,
            },
            {
                "kind": "structural-distance",
                "stage": "portable",
                "minimum": 0.35,
            },
        ],
        "license": "project-internal",
    }


def test_private_catalog_is_opt_in(monkeypatch, client, compiled):
    monkeypatch.delenv(PRIVATE_TEMPLATE_DIR_ENV, raising=False)
    assert private_template_layouts(revision_brand_ir(_revision(client, compiled))) == []


def test_private_catalog_loads_declarative_package(monkeypatch, tmp_path, client, compiled):
    revision = _revision(client, compiled)
    package = _private_package(revision)
    (tmp_path / "impacto-editorial.json").write_text(
        json.dumps(package, ensure_ascii=False),
        encoding="utf-8",
    )
    monkeypatch.setenv(PRIVATE_TEMPLATE_DIR_ENV, str(tmp_path))

    layouts = private_template_layouts(revision_brand_ir(revision))

    assert [layout.id for layout in layouts] == ["impacto-editorial-cover-post-4x5"]
    assert layouts[0].template_ref is not None
    assert layouts[0].template_ref.package_id == "impacto-editorial"


def test_private_catalog_rejects_invalid_package(monkeypatch, tmp_path, client, compiled):
    (tmp_path / "invalido.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv(PRIVATE_TEMPLATE_DIR_ENV, str(tmp_path))
    with pytest.raises(PrivateTemplateCatalogError, match="TemplatePackage"):
        private_template_layouts(revision_brand_ir(_revision(client, compiled)))


def test_private_catalog_rejects_collision_with_public_layout(
    monkeypatch, tmp_path, client, compiled
):
    from brand_api.layout_catalog import current_layouts

    revision = _revision(client, compiled)
    package = _private_package(revision)
    public_layout = generate_template_layouts(revision_brand_ir(revision))[0]
    package["compositions"][0]["id"] = public_layout.id
    package["compositions"][0]["layout"]["id"] = public_layout.id
    package["compositions"][0]["layout"]["templateRef"]["compositionId"] = public_layout.id
    (tmp_path / "impacto-editorial.json").write_text(
        json.dumps(package, ensure_ascii=False),
        encoding="utf-8",
    )
    monkeypatch.setenv(PRIVATE_TEMPLATE_DIR_ENV, str(tmp_path))

    with pytest.raises(ValueError, match="repetidos"):
        current_layouts(revision)
