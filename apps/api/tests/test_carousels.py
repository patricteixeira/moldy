import io
import zipfile

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
            "slides": _slides(5),
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
    assert run_next_job(
        client.app.state.session_factory,
        storage=client.app.state.storage,
        exporter=client.app.state.exporter,
        settings=client.app.state.settings,
        heartbeat_seconds=0.05,
    )

    job = client.get(f"/v1/jobs/{enqueued.json()['jobId']}")
    assert job.status_code == 200
    result = job.json()["result"]
    assert result["format"] == "zip"
    assert result["filename"] == f"{carousel_id}.zip"
    archive_bytes = client.app.state.storage.get(result["sha256"])
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        assert archive.namelist() == ["01.png", "02.png", "03.png"]
