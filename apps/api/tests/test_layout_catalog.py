from brand_api.layout_catalog import public_kit, resolve_layout
from brand_api.models import BrandRevision


def test_versioned_templates_override_stale_revision_snapshot(client, compiled):
    with client.app.state.session_factory() as session:
        revision = session.get(BrandRevision, compiled["brandRevisionId"])
        assert revision is not None
        stale_kit = list(revision.kit)
        target_index = next(
            index
            for index, item in enumerate(stale_kit)
            if item.get("id") == "collage-cutout-post-4x5"
        )
        stale_layout = {**stale_kit[target_index]}
        stale_layers = [dict(layer) for layer in stale_layout["lockedLayers"]]
        stale_mat = next(layer for layer in stale_layers if layer["id"] == "cutout-photo-mat")
        stale_mat["colorToken"] = "color.text"
        stale_mat["opacity"] = 0.13
        stale_layout["lockedLayers"] = stale_layers
        stale_kit[target_index] = stale_layout
        revision.kit = stale_kit
        session.commit()
        session.refresh(revision)

        public_layout = next(
            item for item in public_kit(revision) if item["id"] == stale_layout["id"]
        )
        resolved_layout = resolve_layout(revision, stale_layout["id"])

    assert resolved_layout is not None
    public_mat = next(
        layer for layer in public_layout["lockedLayers"] if layer["id"] == "cutout-photo-mat"
    )
    resolved_mat = next(
        layer for layer in resolved_layout.locked_layers if layer.id == "cutout-photo-mat"
    )
    assert public_mat["colorToken"] == "color.primary"
    assert public_mat["opacity"] == 0.16
    assert resolved_mat.color_token == "color.primary"
    assert resolved_mat.opacity == 0.16
