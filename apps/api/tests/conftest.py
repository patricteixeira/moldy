import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from brand_api.models import Base

MALICIOUS_SVG = b"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <script>alert(1)</script>
  <rect width="60" height="100" fill="#1A4D8F" onclick="evil()"/>
  <circle r="20" fill="#F4A300" stroke="#1A4D8F"/>
  <image href="https://evil.example/x.png"/>
  <use href="#ok"/>
</svg>"""

TEST_DB_URL = os.environ.get(
    "BRANDRT_TEST_DATABASE_URL",
    "postgresql+psycopg://brandrt:brandrt@127.0.0.1:5433/brandrt",
)


@pytest.fixture(scope="session")
def pg_engine():
    engine = create_engine(TEST_DB_URL)
    try:
        with engine.connect():
            pass
    except Exception:
        pytest.fail(
            "Postgres de teste indisponível em localhost:5433 — rode "
            "`docker compose -f compose.dev.yml up -d` (ver README)."
        )
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def db(pg_engine):
    tables = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
    with pg_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} CASCADE"))
    with Session(pg_engine) as session:
        yield session


@pytest.fixture()
def make_client(pg_engine, db, tmp_path):
    from fastapi.testclient import TestClient

    from brand_api.app import create_app
    from brand_api.config import Settings

    clients = []

    def make(**overrides):
        font_resolver = overrides.pop("font_resolver", None)
        identity_translator = overrides.pop("identity_translator", None)
        settings = Settings(
            database_url=TEST_DB_URL,
            data_dir=tmp_path / "var",
            bootstrap_token="test-token",
            fake_exporter=True,
            **overrides,
        )
        client = TestClient(
            create_app(
                settings,
                font_resolver=font_resolver,
                identity_translator=identity_translator,
            )
        )
        client.headers["Authorization"] = "Bearer test-token"
        clients.append(client)
        return client

    yield make
    for client in reversed(clients):
        client.close()
        client.app.state.engine.dispose()


@pytest.fixture()
def client(make_client):
    return make_client()


@pytest.fixture()
def anon(client):
    from fastapi.testclient import TestClient

    anonymous = TestClient(client.app)
    yield anonymous
    anonymous.close()


def _brand_pdf_bytes() -> bytes:
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.draw_rect(
        fitz.Rect(50, 50, 250, 250),
        color=None,
        fill=(26 / 255, 77 / 255, 143 / 255),
    )
    page.draw_rect(
        fitz.Rect(300, 50, 350, 100),
        color=None,
        fill=(244 / 255, 163 / 255, 0),
    )
    page.insert_text(
        (50, 300),
        "Título da Marca",
        fontname="tibo",
        fontsize=24,
        color=(26 / 255, 77 / 255, 143 / 255),
    )
    page.insert_textbox(
        fitz.Rect(50, 340, 545, 500),
        "Texto corrido da marca. " * 10,
        fontname="helv",
        fontsize=11,
        color=(0.2, 0.2, 0.2),
    )
    return doc.tobytes()


def _fixture_font_bytes(*, full_coverage: bool = False) -> bytes:
    import io

    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    extra_characters = (
        "ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç “”‘’–—…•ºª°€" if full_coverage else "áíóãçéêúÁÉÍÓÚÇ"
    )
    codepoints = [*range(32, 127), *(ord(character) for character in extra_characters)]
    names = {codepoint: f"uni{codepoint:04X}" for codepoint in codepoints}
    glyph_order = [".notdef", *names.values()]
    glyphs = {}
    metrics = {}

    notdef_pen = TTGlyphPen(None)
    notdef_pen.moveTo((50, 0))
    notdef_pen.lineTo((450, 0))
    notdef_pen.lineTo((450, 700))
    notdef_pen.lineTo((50, 700))
    notdef_pen.closePath()
    glyphs[".notdef"] = notdef_pen.glyph()
    metrics[".notdef"] = (500, 50)

    for codepoint, name in names.items():
        advance = 300 if codepoint == 32 else 600
        pen = TTGlyphPen(None)
        if codepoint != 32:
            inset = 60 + codepoint % 40
            pen.moveTo((inset, 0))
            pen.lineTo((advance - inset, 0))
            pen.lineTo((advance - inset, 700))
            pen.lineTo((inset, 700))
            pen.closePath()
        glyphs[name] = pen.glyph()
        metrics[name] = (advance, 0)

    font_builder = FontBuilder(1000)
    font_builder.setupGlyphOrder(glyph_order)
    font_builder.setupCharacterMap(names)
    font_builder.setupGlyf(glyphs)
    font_builder.setupHorizontalMetrics(metrics)
    font_builder.setupHorizontalHeader(ascent=800, descent=-200)
    font_builder.setupNameTable({"familyName": "Fixture Sans", "styleName": "Bold"})
    font_builder.setupOS2(usWeightClass=700)
    font_builder.setupPost()
    buffer = io.BytesIO()
    font_builder.save(buffer)
    return buffer.getvalue()


@pytest.fixture(scope="session")
def fixture_font_bytes() -> bytes:
    return _fixture_font_bytes()


@pytest.fixture(scope="session")
def coverage_font_bytes() -> bytes:
    return _fixture_font_bytes(full_coverage=True)


def _png_bytes(w: int = 1200, h: int = 1200, color=(10, 60, 120)) -> bytes:
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture(scope="session")
def package_zip() -> bytes:
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("manual.pdf", _brand_pdf_bytes())
        archive.writestr("assets/logos/logo.svg", MALICIOUS_SVG)
        archive.writestr("fonts/fixture-sans-bold.ttf", _fixture_font_bytes())
    return buffer.getvalue()


def _answers(draft_body: dict) -> dict:
    def first(question_id):
        question = next(item for item in draft_body["questions"] if item["id"] == question_id)
        return question["candidates"][0]["value"]

    identity = first("identity.expression")
    if not identity["essence"].strip():
        identity = {
            **identity,
            "essence": "A marca existe para tornar a criação mais clara.",
            "personality": "Humana, precisa e acessível.",
        }

    return {
        "values": {
            "identity.expression": identity,
            "color.primary": first("color.primary"),
            "color.background": "#FFFFFF",
            "color.text": "#1A1A1A",
            "font.heading": first("font.heading"),
            "font.body": first("font.body"),
            "logo.primary": first("logo.primary"),
        }
    }


@pytest.fixture()
def imported(client, package_zip):
    response = client.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", package_zip, "application/zip")},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture()
def compiled(client, imported):
    response = client.post(
        f"/v1/drafts/{imported['draftId']}/compile",
        json={"answers": _answers(imported), "brandName": "ACME"},
    )
    assert response.status_code == 201, response.text
    return {**imported, "brandRevisionId": response.json()["brandRevisionId"]}
