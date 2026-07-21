import io
import zipfile

from PIL import Image

from brand_api.exporters import FakeExporter
from brand_api.worker import run_next_job


def _slides(count: int) -> list[dict]:
    return [
        {
            "kicker": f"Parte {index + 1}",
            "headline": f"Ideia do slide {index + 1}",
            "textBlocks": (
                ["Primeiro argumento.", "Segundo argumento."]
                if 0 < index < count - 1
                else ["Uma abertura curta."]
                if index == 0
                else []
            ),
            "cta": "Salve para consultar depois." if index == count - 1 else "",
        }
        for index in range(count)
    ]


def test_carousel_derives_cover_content_closing_and_signature(client, compiled):
    slides = _slides(5)
    slides[0]["backgroundColorToken"] = "color.primary"
    slides[0]["textColorToken"] = "color.background"
    slides[0]["logoAssetToken"] = "logo.primary"
    response = client.post(
        "/v1/carousels",
        json={
            "brandRevisionId": compiled["brandRevisionId"],
            "name": "Uma sequência",
            "profile": "post-4x5",
            "signature": {
                "text": "@acme",
                "vertical": "top",
                "horizontal": "right",
            },
            "slides": slides,
        },
    )

    assert response.status_code == 201, response.text
    carousel = response.json()
    assert [slide["role"] for slide in carousel["slides"]] == [
        "cover",
        "content",
        "content",
        "content",
        "closing",
    ]
    assert [slide["layoutId"] for slide in carousel["slides"]] == [
        "carousel-cover-post-4x5",
        "carousel-content-a-post-4x5",
        "carousel-content-b-post-4x5",
        "carousel-content-a-post-4x5",
        "carousel-closing-post-4x5",
    ]
    second = carousel["slides"][1]
    assert second["content"]["values"]["body-1"]["text"] == "Primeiro argumento."
    assert second["content"]["values"]["body-2"]["text"] == "Segundo argumento."
    assert second["content"]["overrides"]["signature"]["area"] == [580, 80, 420, 32]
    assert second["content"]["overrides"]["signature"]["textAlign"] == "right"
    cover = carousel["slides"][0]
    assert cover["source"]["backgroundColorToken"] == "color.primary"
    assert cover["source"]["textColorToken"] == "color.background"
    assert cover["source"]["logoAssetToken"] == "logo.primary"
    assert cover["content"]["backgroundColorToken"] == "color.primary"
    assert cover["content"]["assetBindings"] == {"logo": "logo.primary"}
    assert all(
        override["colorToken"] == "color.background"
        for slot_id, override in cover["content"]["overrides"].items()
        if next(slot for slot in cover["layout"]["slots"] if slot["id"] == slot_id)["kind"]
        == "text"
    )
    assert second["content"]["backgroundColorToken"] is None
    assert second["content"]["assetBindings"] == {}


def test_carousel_accepts_individual_kit_templates_per_slide(client, compiled):
    slides = _slides(3)
    selected = [
        "typographic-ledger-post-4x5",
        "typographic-monument-post-4x5",
        "typographic-diptych-post-4x5",
    ]
    for slide, layout_id in zip(slides, selected, strict=True):
        slide["layoutId"] = layout_id

    response = client.post(
        "/v1/carousels",
        json={
            "brandRevisionId": compiled["brandRevisionId"],
            "name": "Templates do kit",
            "profile": "post-4x5",
            "signature": {
                "text": "@acme",
                "vertical": "bottom",
                "horizontal": "center",
            },
            "slides": slides,
        },
    )

    assert response.status_code == 201, response.text
    carousel = response.json()
    assert [slide["layoutId"] for slide in carousel["slides"]] == selected
    assert [slide["source"]["layoutId"] for slide in carousel["slides"]] == selected
    assert all(
        slide["layout"]["templateRef"]["packageId"] == "typographic-editorial"
        for slide in carousel["slides"]
    )
    assert carousel["slides"][0]["content"]["values"]["headline"]["text"] == ("Ideia do slide 1")


def test_carousel_slide_can_be_edited_without_changing_its_position_or_template(client, compiled):
    created = client.post(
        "/v1/carousels",
        json={
            "brandRevisionId": compiled["brandRevisionId"],
            "name": "Sequência editável",
            "profile": "post-4x5",
            "slides": _slides(3),
        },
    )
    assert created.status_code == 201, created.text
    carousel = created.json()
    slide = carousel["slides"][1]
    content = slide["content"]
    content["values"]["headline"]["text"] = "Mensagem refinada no editor"
    content["backgroundColorToken"] = "color.primary"

    updated = client.patch(
        f"/v1/carousels/{carousel['id']}/slides/{slide['id']}",
        json=content,
    )

    assert updated.status_code == 200, updated.text
    edited = updated.json()
    assert edited["position"] == 2
    assert edited["layoutId"] == slide["layoutId"]
    assert edited["content"]["values"]["headline"]["text"] == "Mensagem refinada no editor"
    assert edited["content"]["backgroundColorToken"] == "color.primary"
    reloaded = client.get(f"/v1/carousels/{carousel['id']}").json()
    assert reloaded["slides"][1]["content"] == edited["content"]


def test_every_public_social_template_can_materialize_in_a_carousel(client, compiled):
    kit_response = client.get(f"/v1/brand-revisions/{compiled['brandRevisionId']}/kit")
    assert kit_response.status_code == 200
    layouts = [layout for layout in kit_response.json() if layout["profile"] == "post-4x5"]

    image_bytes = io.BytesIO()
    Image.new("RGB", (1080, 1350), "#d8d5cd").save(image_bytes, format="PNG")
    uploaded = client.post(
        "/v1/assets",
        files={"file": ("carousel.png", image_bytes.getvalue(), "image/png")},
    )
    assert uploaded.status_code == 201, uploaded.text
    image_sha256 = uploaded.json()["sha256"]

    seen: list[str] = []
    for offset in range(0, len(layouts), 20):
        original_batch = layouts[offset : offset + 20]
        batch = [*original_batch]
        if len(batch) < 3:
            batch.extend(layouts[: 3 - len(batch)])
        slides = [
            {
                "kicker": f"Parte {index}",
                "headline": f"Mensagem {index}",
                "textBlocks": ["Um argumento curto.", "Uma segunda leitura."],
                "cta": "Continue a conversa.",
                "layoutId": layout["id"],
                "imageSha256": image_sha256,
            }
            for index, layout in enumerate(batch, start=1)
        ]
        response = client.post(
            "/v1/carousels",
            json={
                "brandRevisionId": compiled["brandRevisionId"],
                "name": f"Catálogo {offset // 20 + 1}",
                "profile": "post-4x5",
                "signature": {
                    "text": "@acme",
                    "vertical": "bottom",
                    "horizontal": "left",
                },
                "slides": slides,
            },
        )
        assert response.status_code == 201, (
            response.text,
            [layout["id"] for layout in batch],
        )
        materialized = response.json()["slides"]
        assert not [
            check
            for slide in materialized
            for check in slide["checks"]
            if check["status"] == "blocked"
        ]
        seen.extend(slide["layoutId"] for slide in materialized[: len(original_batch)])

    assert seen == [layout["id"] for layout in layouts]


def test_carousel_export_publishes_ordered_png_zip(client, compiled):
    created = client.post(
        "/v1/carousels",
        json={
            "brandRevisionId": compiled["brandRevisionId"],
            "name": "Três atos",
            "profile": "post-1x1",
            "signature": {
                "text": "@acme",
                "vertical": "bottom",
                "horizontal": "left",
            },
            "slides": _slides(3),
        },
    )
    assert created.status_code == 201, created.text
    carousel_id = created.json()["id"]

    enqueued = client.post(f"/v1/carousels/{carousel_id}/exports", json={"format": "png"})
    assert enqueued.status_code == 202, enqueued.text
    batch_calls = []

    class BatchSpy(FakeExporter):
        def export(self, **kwargs):
            if kwargs["fmt"] == "png":
                raise AssertionError("o worker não deve exportar um slide PNG por vez")
            return super().export(**kwargs)

        def export_png_batch(self, **kwargs):
            batch_calls.append(kwargs["documents"])
            return [
                FakeExporter.export(
                    self,
                    ir=kwargs["ir"],
                    layout=layout,
                    content=content,
                    assets_dir=kwargs["assets_dir"],
                    fmt="png",
                    out_path=out_path,
                )
                for layout, content, out_path in kwargs["documents"]
            ]

    assert run_next_job(
        client.app.state.session_factory,
        storage=client.app.state.storage,
        exporter=BatchSpy(),
        settings=client.app.state.settings,
        heartbeat_seconds=0.05,
    )
    assert len(batch_calls) == 1
    assert len(batch_calls[0]) == 3

    job = client.get(f"/v1/jobs/{enqueued.json()['jobId']}")
    assert job.status_code == 200
    result = job.json()["result"]
    assert result["format"] == "zip"
    assert result["filename"] == f"{carousel_id}.zip"
    archive_bytes = client.app.state.storage.get(result["sha256"])
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        assert archive.namelist() == ["01.png", "02.png", "03.png"]
