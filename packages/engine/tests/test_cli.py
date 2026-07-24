import json

import brand_runtime
import pytest
from typer.testing import CliRunner

import brand_runtime._io as artifact_io
from brand_runtime._io import publish_file_set
from brand_runtime.cli import app
from brand_runtime.guard.static_checks import GuardVerdict
from brand_runtime.ir.models import BrandIR
from brand_runtime.kit.models import LayoutSpec

runner = CliRunner()


def test_engine_walking_skeleton(brand_package, tmp_path):
    draft_p = tmp_path / "draft.json"
    result = runner.invoke(app, ["extract", str(brand_package), "--out", str(draft_p)])
    assert result.exit_code == 0, result.output
    draft = json.loads(draft_p.read_text(encoding="utf-8"))

    def first(question_id):
        question = next(
            question for question in draft["questions"] if question["id"] == question_id
        )
        return question["candidates"][0]["value"]

    answers_p = tmp_path / "answers.json"
    answers_p.write_text(
        json.dumps(
            {
                "values": {
                    "identity.expression": {
                        **first("identity.expression"),
                        "essence": "Clareza artesanal para quem precisa criar.",
                    },
                    "color.primary": first("color.primary"),
                    "color.background": "#FFFFFF",
                    "color.text": "#1A1A1A",
                    "font.heading": first("font.heading"),
                    "font.body": first("font.body"),
                    "logo.primary": first("logo.primary"),
                }
            }
        ),
        encoding="utf-8",
    )

    ir_p = tmp_path / "ir.json"
    result = runner.invoke(
        app,
        [
            "compile",
            str(draft_p),
            str(answers_p),
            "--name",
            "Ateliê Açúcar",
            "--out",
            str(ir_p),
        ],
    )
    assert result.exit_code == 0, result.output
    ir = BrandIR.model_validate_json(ir_p.read_text(encoding="utf-8"))
    assert ir.brand.name == "Ateliê Açúcar"
    assert ir_p.read_bytes().startswith(b"\xef\xbb\xbf") is False
    assert ir_p.read_text(encoding="utf-8").endswith("\n")

    kit_dir = tmp_path / "kit"
    result = runner.invoke(app, ["kit", str(ir_p), "--out-dir", str(kit_dir)])
    assert result.exit_code == 0, result.output
    assert len(list(kit_dir.glob("*.json"))) == 88
    for layout_path in kit_dir.glob("*.json"):
        LayoutSpec.model_validate_json(layout_path.read_text(encoding="utf-8"))

    content_p = tmp_path / "content.json"
    content_p.write_text(
        json.dumps(
            {
                "layoutId": "statement-post-1x1",
                "brandRevisionId": json.loads(ir_p.read_text(encoding="utf-8"))["revision"]["id"],
                "values": {"headline": {"kind": "text", "text": "Lançamento em agosto"}},
            }
        ),
        encoding="utf-8",
    )
    result = runner.invoke(
        app,
        [
            "guard",
            str(ir_p),
            str(kit_dir / "statement-post-1x1.json"),
            str(content_p),
            "--assets-dir",
            str(brand_package),
        ],
    )
    assert result.exit_code == 0, result.output
    passed = GuardVerdict.model_validate_json(result.stdout)
    assert passed.checks and all(check.status == "pass" for check in passed.checks)
    assert result.stderr == ""

    content_p.write_text(
        json.dumps(
            {
                "layoutId": "statement-post-1x1",
                "brandRevisionId": "brandrev_x",
                "values": {"headline": {"kind": "text", "text": "A" * 200}},
            }
        ),
        encoding="utf-8",
    )
    result = runner.invoke(
        app,
        [
            "guard",
            str(ir_p),
            str(kit_dir / "statement-post-1x1.json"),
            str(content_p),
            "--assets-dir",
            str(brand_package),
        ],
    )
    assert result.exit_code == 3
    blocked = GuardVerdict.model_validate_json(result.stdout)
    assert any(check.status == "blocked" for check in blocked.checks)
    assert result.stderr == ""


def test_automatic_required_answers_compile_without_manual_values(brand_package, tmp_path):
    draft_p = tmp_path / "draft.json"
    runner.invoke(app, ["extract", str(brand_package), "--out", str(draft_p)])
    answers_p = tmp_path / "answers.json"
    answers_p.write_text(json.dumps({"values": {}}), encoding="utf-8")
    output_p = tmp_path / "ir.json"
    result = runner.invoke(
        app,
        [
            "compile",
            str(draft_p),
            str(answers_p),
            "--name",
            "ACME",
            "--out",
            str(output_p),
        ],
    )
    assert result.exit_code == 0
    assert output_p.is_file()
    assert result.stderr == ""


def test_missing_required_logo_exits_2(brand_package, tmp_path):
    (brand_package / "assets" / "logos" / "logo.svg").unlink()
    draft_p = tmp_path / "draft.json"
    runner.invoke(app, ["extract", str(brand_package), "--out", str(draft_p)])
    answers_p = tmp_path / "answers.json"
    answers_p.write_text(json.dumps({"values": {}}), encoding="utf-8")
    result = runner.invoke(
        app,
        [
            "compile",
            str(draft_p),
            str(answers_p),
            "--name",
            "ACME",
            "--out",
            str(tmp_path / "ir.json"),
        ],
    )
    assert result.exit_code == 2
    assert result.stdout == ""
    assert "logo.primary" in result.stderr


def test_schemas_exports_all_published_contracts(tmp_path):
    out_dir = tmp_path / "schemas"
    out_dir.mkdir()
    license_bytes = b"licenca preservada\r\n"
    (out_dir / "LICENSE").write_bytes(license_bytes)
    result = runner.invoke(app, ["schemas", "--out-dir", str(out_dir)])
    assert result.exit_code == 0, result.output
    schema_names = {
        "brand-ir.schema.json",
        "layout-spec.schema.json",
        "content-spec.schema.json",
        "style-system-ir.schema.json",
        "template-package.schema.json",
        "artifact-instance.schema.json",
        "guard-verdict.schema.json",
        "document-graph.schema.json",
        "roundtrip-report.schema.json",
        "fix-plan.schema.json",
        "fix-result.schema.json",
        "docx-brand-plan.schema.json",
        "docx-brand-result.schema.json",
        "brand-package.schema.json",
        "package-validation-report.schema.json",
        "template-corpus-manifest.schema.json",
        "template-reference.schema.json",
        "template-corpus-report.schema.json",
    }
    assert {path.name for path in out_dir.glob("*.json")} == schema_names
    assert (out_dir / "LICENSE").read_bytes() == license_bytes
    for path in out_dir.glob("*.json"):
        assert json.loads(path.read_text(encoding="utf-8"))
        assert path.read_text(encoding="utf-8").endswith("\n")
    assert list(out_dir.glob("*.tmp")) == []

    repeated = runner.invoke(app, ["schemas", "--out-dir", str(out_dir)])
    assert repeated.exit_code == 0, repeated.output
    assert {path.name for path in out_dir.iterdir()} == schema_names | {"LICENSE"}
    assert (out_dir / "LICENSE").read_bytes() == license_bytes


def test_invalid_json_is_exit_2_and_preserves_previous_output(tmp_path):
    invalid = tmp_path / "invalid.json"
    invalid.write_text("{não-json", encoding="utf-8")
    answers = tmp_path / "answers.json"
    answers.write_text('{"values": {}}', encoding="utf-8")
    previous = tmp_path / "ir.json"
    previous.write_text("sentinela\n", encoding="utf-8")

    result = runner.invoke(
        app,
        ["compile", str(invalid), str(answers), "--name", "ACME", "--out", str(previous)],
    )

    assert result.exit_code == 2
    assert result.stdout == ""
    assert "JSON válido" in result.stderr
    assert previous.read_text(encoding="utf-8") == "sentinela\n"
    assert list(tmp_path.glob("*.tmp")) == []


def test_extract_rejects_missing_package_and_help_lists_commands(tmp_path):
    result = runner.invoke(
        app,
        ["extract", str(tmp_path / "ausente"), "--out", str(tmp_path / "draft.json")],
    )
    assert result.exit_code == 2
    assert result.stdout == ""
    assert "não é um diretório válido" in result.stderr

    help_result = runner.invoke(app, ["--help"])
    assert help_result.exit_code == 0
    for command in (
        "extract",
        "compile",
        "kit",
        "guard",
        "schemas",
        "roundtrip-parse",
        "roundtrip-lint",
        "roundtrip-plan",
        "roundtrip-fix",
        "docx-brand-plan",
        "docx-brand-apply",
        "package-validate",
        "template-corpus-audit",
    ):
        assert command in help_result.stdout


def test_master_api_is_exported_from_package_root():
    for name in (
        "build_draft",
        "compile_ir",
        "generate_kit",
        "run_static_checks",
        "GuardCheck",
        "GuardVerdict",
        "export_schemas",
        "FixPlan",
        "FixResult",
        "build_fix_plan",
        "apply_pptx_fix_plan",
        "DocxBrandPlan",
        "DocxBrandResult",
        "analyze_docx_brand",
        "apply_docx_brand_plan",
        "validate_brand_package",
        "BrandPackageManifest",
        "PackageValidationReport",
        "audit_template_corpus",
        "TemplateCorpusManifest",
        "TemplateCorpusReport",
        "TemplateReferenceManifest",
    ):
        assert name in brand_runtime.__all__
        assert callable(getattr(brand_runtime, name)) or name in {"GuardCheck", "GuardVerdict"}


def test_extract_persists_absolute_package_root(brand_package, tmp_path, monkeypatch):
    monkeypatch.chdir(brand_package.parent)
    draft_path = tmp_path / "draft.json"
    result = runner.invoke(
        app,
        ["extract", brand_package.name, "--out", str(draft_path)],
    )
    assert result.exit_code == 0, result.output
    draft = json.loads(draft_path.read_text(encoding="utf-8"))
    assert draft["packageDir"] == str(brand_package.resolve())


def test_file_set_publication_rolls_back_if_directory_swap_fails(tmp_path, monkeypatch):
    out_dir = tmp_path / "artifacts"
    out_dir.mkdir()
    (out_dir / "a.json").write_text("versão anterior\n", encoding="utf-8")
    (out_dir / "LICENSE").write_bytes(b"sidecar\r\n")
    real_replace = artifact_io.os.replace

    def fail_stage_swap(source, target):
        source_path = artifact_io.Path(source)
        target_path = artifact_io.Path(target)
        if target_path == out_dir and ".stage-" in source_path.name:
            raise OSError("falha simulada no swap")
        return real_replace(source, target)

    monkeypatch.setattr(artifact_io.os, "replace", fail_stage_swap)
    with pytest.raises(OSError, match="falha simulada"):
        publish_file_set(
            out_dir,
            {"a.json": "versão nova\n"},
            preserve={"LICENSE"},
        )

    assert (out_dir / "a.json").read_text(encoding="utf-8") == "versão anterior\n"
    assert (out_dir / "LICENSE").read_bytes() == b"sidecar\r\n"
    assert not any(".stage-" in path.name or ".backup-" in path.name for path in tmp_path.iterdir())


def test_schemas_rejects_stale_artifacts_without_partial_publication(tmp_path):
    out_dir = tmp_path / "schemas"
    out_dir.mkdir()
    stale = out_dir / "schema-antigo.json"
    stale.write_text("{}\n", encoding="utf-8")

    result = runner.invoke(app, ["schemas", "--out-dir", str(out_dir)])

    assert result.exit_code == 2
    assert stale.exists()
    assert {path.name for path in out_dir.iterdir()} == {"schema-antigo.json"}
