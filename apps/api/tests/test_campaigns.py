from io import BytesIO

from PIL import Image
from sqlalchemy import select

from brand_api.models import Campaign, CampaignPiece, Document


def _image_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (1400, 1400), "#173F2C").save(output, format="PNG")
    return output.getvalue()


def _fields(image_sha256: str, *, suffix: str = "") -> dict:
    return {
        "headline": f"Semana de lançamento{suffix}",
        "body": f"Uma mensagem central para toda a equipe{suffix}.",
        "cta": f"Conheça agora{suffix}",
        "date": "24 de julho",
        "imageSha256": image_sha256,
    }


def test_campaign_create_update_propagates_transactionally(client, compiled, db):
    upload = client.post(
        "/v1/assets",
        files={"file": ("campanha.png", _image_bytes(), "image/png")},
    )
    assert upload.status_code == 201, upload.text
    image_sha256 = upload.json()["sha256"]
    response = client.post(
        "/v1/campaigns",
        json={
            "brandRevisionId": compiled["brandRevisionId"],
            "name": "Lançamento de julho",
            "fields": _fields(image_sha256),
            "layoutIds": ["announce-post-1x1", "one-pager-doc-a4"],
        },
    )
    assert response.status_code == 201, response.text
    campaign = response.json()
    assert campaign["id"].startswith("campaign_")
    assert len(campaign["pieces"]) == 2
    original_documents = {piece["layoutId"]: piece["documentId"] for piece in campaign["pieces"]}
    social = next(piece for piece in campaign["pieces"] if piece["layoutId"] == "announce-post-1x1")
    assert social["content"]["values"]["headline"]["text"] == "Semana de lançamento"
    assert "24 de julho · Conheça agora" in social["content"]["values"]["body"]["text"]
    assert social["content"]["values"]["photo"]["sha256"] == image_sha256
    assert {"headline", "logo"}.issubset(social["content"]["overrides"])
    assert all(check["status"] != "blocked" for check in social["checks"])

    response = client.patch(
        f"/v1/campaigns/{campaign['id']}",
        json={"name": "Lançamento atualizado", "fields": _fields(image_sha256, suffix=" 2")},
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["name"] == "Lançamento atualizado"
    assert {
        piece["layoutId"]: piece["documentId"] for piece in updated["pieces"]
    } == original_documents
    for piece in updated["pieces"]:
        text = "\n".join(
            value["text"]
            for value in piece["content"]["values"].values()
            if value["kind"] == "text"
        )
        assert "2" in text
        assert "24 de julho" in text
        assert "Conheça agora 2" in text

    listing = client.get(f"/v1/brand-revisions/{compiled['brandRevisionId']}/campaigns")
    assert listing.status_code == 200
    assert [item["id"] for item in listing.json()] == [campaign["id"]]

    persisted = db.get(Campaign, campaign["id"])
    assert persisted is not None and persisted.fields["headline"].endswith(" 2")
    pieces = list(
        db.scalars(select(CampaignPiece).where(CampaignPiece.campaign_id == campaign["id"]))
    )
    assert len(pieces) == 2
    assert all(db.get(Document, piece.document_id) is not None for piece in pieces)


def test_campaign_validates_image_layouts_and_auth(client, anon, compiled):
    base = {
        "brandRevisionId": compiled["brandRevisionId"],
        "name": "Campanha",
        "fields": {
            "headline": "Mensagem",
            "body": "Corpo",
            "cta": "Saiba mais",
            "date": "Hoje",
            "imageSha256": "0" * 64,
        },
        "layoutIds": ["announce-post-1x1"],
    }
    missing_image = client.post("/v1/campaigns", json=base)
    assert missing_image.status_code == 422
    assert missing_image.json()["detail"] == (
        "A imagem da campanha não foi encontrada — envie-a novamente."
    )

    no_image = {**base, "fields": {**base["fields"], "imageSha256": None}}
    incomplete_photo_layout = client.post("/v1/campaigns", json=no_image)
    assert incomplete_photo_layout.status_code == 422
    assert "precisa de uma imagem" in incomplete_photo_layout.json()["detail"]

    duplicated = client.post(
        "/v1/campaigns",
        json={**no_image, "layoutIds": ["statement-post-1x1", "statement-post-1x1"]},
    )
    assert duplicated.status_code == 422

    unknown = client.post("/v1/campaigns", json={**no_image, "layoutIds": ["unknown"]})
    assert unknown.status_code == 422
    assert unknown.json()["detail"] == "Layout desconhecido para esta revisão."

    unauthorized = anon.post("/v1/campaigns", json=no_image)
    assert unauthorized.status_code == 401
