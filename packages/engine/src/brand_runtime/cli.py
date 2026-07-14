"""CLI arquivo→arquivo do walking skeleton do brand-runtime."""

from __future__ import annotations

import json
from pathlib import Path
from typing import NoReturn, TypeVar

import pymupdf
import typer
from PIL import Image, UnidentifiedImageError
from fontTools.ttLib import TTLibError
from pydantic import BaseModel, ValidationError

from brand_runtime._io import atomic_write_text, publish_file_set
from brand_runtime.export import ExportBlocked, ExportError, export_document
from brand_runtime.guard.static_checks import GuardVerdict, run_static_checks
from brand_runtime.intake.compile import Answers, CompileError, compile_ir
from brand_runtime.intake.dtcg import DtcgError
from brand_runtime.intake.draft import BrandDraft, build_draft
from brand_runtime.intake.svg_logo import SvgInvalid
from brand_runtime.ir.models import BrandIR
from brand_runtime.ir.schema import export_schemas
from brand_runtime.kit.generator import KitGenerationError, generate_kit
from brand_runtime.kit.models import ContentSpec, LayoutSpec
from brand_runtime.native.docx import render_docx
from brand_runtime.native.ooxml import OoxmlError, canonical_ooxml_manifest, validate_ooxml
from brand_runtime.native.pptx import inspect_semantic_shapes, render_pptx
from brand_runtime.native.preview import render_native_preview
from brand_runtime.native.theme import derive_branded_template
from brand_runtime.roundtrip.fix import (
    FixPlan,
    RoundtripFixError,
    apply_pptx_fix_plan,
    build_fix_plan,
)
from brand_runtime.roundtrip.lint import RoundtripReport, lint_roundtrip
from brand_runtime.roundtrip.models import DocumentGraph
from brand_runtime.roundtrip.pptx import PptxParseError, parse_pptx_document_graph

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Compila pacotes de marca em artefatos determinísticos do brand-runtime.",
)

ModelT = TypeVar("ModelT", bound=BaseModel)


class CliInputError(ValueError):
    """Erro de entrada ou destino que pode ser mostrado diretamente à pessoa usuária."""


_EXPECTED_ERRORS = (
    CliInputError,
    CompileError,
    KitGenerationError,
    DtcgError,
    SvgInvalid,
    ValidationError,
    TTLibError,
    UnidentifiedImageError,
    Image.DecompressionBombError,
    Image.DecompressionBombWarning,
    pymupdf.FileDataError,
    UnicodeError,
    OSError,
    ValueError,
    OoxmlError,
    PptxParseError,
    RoundtripFixError,
)


@app.command("roundtrip-parse")
def roundtrip_parse_command(
    source: Path = typer.Argument(..., help="PPTX editado externamente."),
    out: Path | None = typer.Option(None, "--out", help="JSON do Document Graph."),
) -> None:
    """Converte um PPTX editado no Document Graph versionado do M3."""
    try:
        graph = parse_pptx_document_graph(source)
    except _EXPECTED_ERRORS as error:
        _fail(error)
    payload = graph.model_dump_json(by_alias=True, indent=2) + "\n"
    if out is None:
        typer.echo(payload, nl=False)
        return
    atomic_write_text(out, payload)
    typer.echo(str(out))


@app.command("roundtrip-lint")
def roundtrip_lint_command(
    baseline: Path = typer.Argument(..., help="Document Graph do arquivo exportado."),
    edited: Path = typer.Argument(..., help="Document Graph do arquivo editado."),
    brand_ir: Path | None = typer.Option(None, "--brand-ir", help="Brand IR autoritativo."),
    out: Path | None = typer.Option(None, "--out", help="JSON do relatório de round-trip."),
) -> None:
    """Compara o arquivo editado com o original e, opcionalmente, com a marca."""
    try:
        report = lint_roundtrip(
            _read_model(baseline, DocumentGraph),
            _read_model(edited, DocumentGraph),
            _read_model(brand_ir, BrandIR) if brand_ir is not None else None,
        )
    except _EXPECTED_ERRORS as error:
        _fail(error)
    payload = report.model_dump_json(by_alias=True, indent=2) + "\n"
    if out is None:
        typer.echo(payload, nl=False)
        return
    atomic_write_text(out, payload)
    typer.echo(str(out))


@app.command("roundtrip-plan")
def roundtrip_plan_command(
    edited: Path = typer.Argument(..., help="Document Graph do arquivo editado."),
    report: Path = typer.Argument(..., help="Relatório produzido por roundtrip-lint."),
    out: Path | None = typer.Option(None, "--out", help="JSON do plano de correção."),
) -> None:
    """Transforma findings corrigíveis em um plano versionado e deduplicado."""
    try:
        plan = build_fix_plan(
            _read_model(edited, DocumentGraph),
            _read_model(report, RoundtripReport),
        )
    except _EXPECTED_ERRORS as error:
        _fail(error)
    payload = _model_json(plan)
    if out is None:
        typer.echo(payload, nl=False)
        return
    atomic_write_text(out, payload)
    typer.echo(str(out))


@app.command("roundtrip-fix")
def roundtrip_fix_command(
    source: Path = typer.Argument(..., help="PPTX editado que originou o plano."),
    baseline: Path = typer.Argument(..., help="Document Graph do arquivo original."),
    plan: Path = typer.Argument(..., help="FixPlan produzido por roundtrip-plan."),
    out: Path = typer.Option(..., "--out", help="Nova cópia PPTX corrigida."),
    brand_ir: Path | None = typer.Option(None, "--brand-ir", help="Brand IR autoritativo."),
    result_out: Path | None = typer.Option(
        None,
        "--result-out",
        help="JSON com hashes, operações aplicadas e relint.",
    ),
) -> None:
    """Aplica o plano em uma cópia PPTX e executa o relint do novo artefato."""
    try:
        result = apply_pptx_fix_plan(
            source,
            out,
            _read_model(plan, FixPlan),
            _read_model(baseline, DocumentGraph),
            _read_model(brand_ir, BrandIR) if brand_ir is not None else None,
        )
        if result_out is not None:
            atomic_write_text(result_out, _model_json(result))
    except _EXPECTED_ERRORS as error:
        _fail(error)
    typer.echo(str(out))


def _error_message(error: Exception) -> str:
    """Retorne uma mensagem PT-BR para uma falha operacional esperada."""
    if isinstance(error, (CliInputError, CompileError, KitGenerationError, ExportError)):
        return str(error)
    if isinstance(error, ValidationError):
        return "O JSON informado não corresponde ao contrato esperado."
    if isinstance(error, OSError):
        return "Não foi possível ler ou gravar um dos arquivos informados."
    return "Não foi possível processar os arquivos informados."


def _fail(error: Exception) -> NoReturn:
    """Encerra o comando com o código reservado a erro de entrada/operação."""
    typer.echo(_error_message(error), err=True)
    raise typer.Exit(code=2)


def _read_model(path: Path, model: type[ModelT]) -> ModelT:
    """Lê um arquivo JSON UTF-8 regular e o valida no modelo solicitado."""
    if not path.is_file():
        raise CliInputError(f"O arquivo «{path}» não foi encontrado.")
    try:
        payload = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise CliInputError(f"Não foi possível ler o arquivo «{path}» em UTF-8.") from exc
    try:
        return model.model_validate_json(payload)
    except ValidationError as exc:
        raise CliInputError(
            f"O arquivo «{path}» não contém um JSON válido para este comando."
        ) from exc


def _model_json(model: BaseModel) -> str:
    """Serializa um artefato validado em camelCase, indentado e com newline final."""
    return model.model_dump_json(by_alias=True, indent=2) + "\n"


def _safe_layout_filename(layout: LayoutSpec) -> str:
    """Deriva o filename sem permitir que um id de layout escape do diretório."""
    filename = f"{layout.id}.json"
    if (
        not layout.id
        or layout.id in {".", ".."}
        or "/" in layout.id
        or "\\" in layout.id
        or Path(filename).name != filename
    ):
        raise CliInputError(f"O id de layout «{layout.id}» não pode virar nome de arquivo.")
    return filename


@app.command("extract")
def extract_command(
    package_dir: Path = typer.Argument(..., help="Diretório do pacote informal de marca."),
    out: Path = typer.Option(..., "--out", help="Arquivo draft.json de saída."),
) -> None:
    """Extrai evidências e perguntas do wizard de um pacote de marca."""
    try:
        if not package_dir.is_dir():
            raise CliInputError(f"O pacote «{package_dir}» não é um diretório válido.")
        draft = build_draft(package_dir.resolve(strict=True))
        # O próprio round-trip protege a superfície escrita contra serialização divergente.
        BrandDraft.model_validate_json(draft.model_dump_json(by_alias=True))
        atomic_write_text(out, _model_json(draft))
    except _EXPECTED_ERRORS as error:
        _fail(error)


@app.command("compile")
def compile_command(
    draft_json: Path = typer.Argument(..., help="Draft JSON produzido por extract."),
    answers_json: Path = typer.Argument(..., help="Respostas do wizard em JSON."),
    name: str = typer.Option(..., "--name", help="Nome confirmado da marca."),
    out: Path = typer.Option(..., "--out", help="Arquivo Brand IR de saída."),
) -> None:
    """Compila respostas confirmadas em uma revisão imutável do Brand IR."""
    try:
        draft = _read_model(draft_json, BrandDraft)
        answers = _read_model(answers_json, Answers)
        if not name.strip():
            raise CliInputError("Informe um nome de marca não vazio.")
        ir = compile_ir(draft, answers, name)
        BrandIR.model_validate_json(ir.model_dump_json(by_alias=True))
        atomic_write_text(out, _model_json(ir))
    except _EXPECTED_ERRORS as error:
        _fail(error)


@app.command("kit")
def kit_command(
    ir_json: Path = typer.Argument(..., help="Brand IR confirmado em JSON."),
    out_dir: Path = typer.Option(..., "--out-dir", help="Diretório dos Layout Specs."),
) -> None:
    """Gera os dez Layout Specs canônicos da revisão de marca."""
    try:
        ir = _read_model(ir_json, BrandIR)
        layouts = generate_kit(ir)
        serialized = [(_safe_layout_filename(layout), _model_json(layout)) for layout in layouts]
        publish_file_set(out_dir, dict(serialized))
    except _EXPECTED_ERRORS as error:
        _fail(error)


@app.command("guard")
def guard_command(
    ir_json: Path = typer.Argument(..., help="Brand IR em JSON."),
    layout_json: Path = typer.Argument(..., help="Layout Spec em JSON."),
    content_json: Path = typer.Argument(..., help="Content Spec em JSON."),
    assets_dir: Path = typer.Option(..., "--assets-dir", help="Raiz autorizada dos assets."),
) -> None:
    """Executa o Guard e imprime um GuardVerdict JSON em stdout."""
    try:
        ir = _read_model(ir_json, BrandIR)
        layout = _read_model(layout_json, LayoutSpec)
        content = _read_model(content_json, ContentSpec)
        if not assets_dir.is_dir():
            raise CliInputError(f"O diretório de assets «{assets_dir}» não existe.")
        verdict = GuardVerdict(checks=run_static_checks(ir, layout, content, assets_dir))
    except _EXPECTED_ERRORS as error:
        _fail(error)
    typer.echo(verdict.model_dump_json(by_alias=True, indent=2))
    if any(check.status == "blocked" for check in verdict.checks):
        raise typer.Exit(code=3)


@app.command("export")
def export_command(
    ir_json: Path = typer.Argument(..., help="Brand IR em JSON."),
    layout_json: Path = typer.Argument(..., help="Layout Spec em JSON."),
    content_json: Path = typer.Argument(..., help="Content Spec em JSON."),
    assets_dir: Path = typer.Option(..., "--assets-dir", help="Raiz autorizada dos assets."),
    render_dist: Path = typer.Option(..., "--render-dist", help="Build dist do renderer."),
    out: Path = typer.Option(..., "--out", help="Arquivo PNG ou PDF de saída."),
) -> None:
    """Renderiza um documento autorizado pelo Guard em PNG ou PDF."""
    try:
        ir = _read_model(ir_json, BrandIR)
        layout = _read_model(layout_json, LayoutSpec)
        content = _read_model(content_json, ContentSpec)
        if not assets_dir.is_dir():
            raise CliInputError(f"O diretório de assets «{assets_dir}» não existe.")
        result = export_document(ir, layout, content, assets_dir, render_dist, out)
    except ExportBlocked as error:
        typer.echo(error.verdict.model_dump_json(by_alias=True, indent=2), err=True)
        raise typer.Exit(code=3) from error
    except (*_EXPECTED_ERRORS, ExportError) as error:
        _fail(error)
    typer.echo(result.out_path)


@app.command("schemas")
def schemas_command(
    out_dir: Path = typer.Option(..., "--out-dir", help="Diretório dos JSON Schemas."),
) -> None:
    """Publica os schemas compartilhados do motor."""
    try:
        if out_dir.exists() and not out_dir.is_dir():
            raise CliInputError(f"O destino «{out_dir}» não é um diretório.")
        paths = export_schemas(out_dir)
        if len(paths) != 8:
            raise CliInputError("A publicação de schemas não produziu os contratos esperados.")
    except _EXPECTED_ERRORS as error:
        _fail(error)


@app.command("native-theme")
def native_theme_command(
    ir_json: Path = typer.Argument(..., help="Brand IR confirmado em JSON."),
    template: Path = typer.Argument(..., help="Template PPTX ou DOCX de origem."),
    out: Path = typer.Option(..., "--out", help="Template temático de saída."),
) -> None:
    """Deriva uma cópia temática do template sem alterar o arquivo original."""
    try:
        ir = _read_model(ir_json, BrandIR)
        result = derive_branded_template(template, out, ir)
    except _EXPECTED_ERRORS as error:
        _fail(error)
    typer.echo(result)


@app.command("native-pptx")
def native_pptx_command(
    ir_json: Path = typer.Argument(..., help="Brand IR confirmado em JSON."),
    layout_json: Path = typer.Argument(..., help="Layout Spec em JSON."),
    content_json: Path = typer.Argument(..., help="Content Spec em JSON."),
    template: Path = typer.Argument(..., help="Template PPTX temático."),
    assets_dir: Path = typer.Option(..., "--assets-dir", help="Raiz autorizada dos assets."),
    out: Path = typer.Option(..., "--out", help="PPTX nativo de saída."),
    native_layout: str | None = typer.Option(
        None,
        "--native-layout",
        help="Nome do layout do template; omita para escolher o primeiro compatível.",
    ),
) -> None:
    """Preenche um slide nativo a partir dos contratos do M1."""
    try:
        ir = _read_model(ir_json, BrandIR)
        layout = _read_model(layout_json, LayoutSpec)
        content = _read_model(content_json, ContentSpec)
        if not assets_dir.is_dir():
            raise CliInputError(f"O diretório de assets «{assets_dir}» não existe.")
        result = render_pptx(
            template,
            out,
            ir,
            layout,
            content,
            asset_root=assets_dir,
            native_layout_name=native_layout,
        )
    except _EXPECTED_ERRORS as error:
        _fail(error)
    typer.echo(result)


@app.command("native-docx")
def native_docx_command(
    ir_json: Path = typer.Argument(..., help="Brand IR confirmado em JSON."),
    layout_json: Path = typer.Argument(..., help="Layout Spec em JSON."),
    content_json: Path = typer.Argument(..., help="Content Spec em JSON."),
    template: Path = typer.Argument(..., help="Template DOCX temático."),
    assets_dir: Path = typer.Option(..., "--assets-dir", help="Raiz autorizada dos assets."),
    out: Path = typer.Option(..., "--out", help="DOCX nativo de saída."),
) -> None:
    """Preenche um documento nativo com placeholders e estilos semânticos."""
    try:
        ir = _read_model(ir_json, BrandIR)
        layout = _read_model(layout_json, LayoutSpec)
        content = _read_model(content_json, ContentSpec)
        if not assets_dir.is_dir():
            raise CliInputError(f"O diretório de assets «{assets_dir}» não existe.")
        result = render_docx(
            template,
            out,
            ir,
            layout,
            content,
            asset_root=assets_dir,
        )
    except _EXPECTED_ERRORS as error:
        _fail(error)
    typer.echo(result)


@app.command("native-preview")
def native_preview_command(
    source: Path = typer.Argument(..., help="PPTX ou DOCX nativo de origem."),
    out_dir: Path = typer.Option(..., "--out-dir", help="Diretório do PDF e dos PNGs."),
) -> None:
    """Gera preview derivado por LibreOffice, mantendo o OOXML imutável."""
    try:
        result = render_native_preview(source, out_dir)
    except _EXPECTED_ERRORS as error:
        _fail(error)
    typer.echo(
        json.dumps(
            {
                "ok": result.ok,
                "pdfPath": str(result.pdf_path) if result.pdf_path else None,
                "pngPaths": [str(path) for path in result.png_paths],
                "diagnostics": [
                    {
                        "code": item.code,
                        "severity": item.severity,
                        "message": item.message,
                        "part": item.part,
                    }
                    for item in result.diagnostics
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    if not result.ok:
        raise typer.Exit(code=4)


@app.command("native-inspect")
def native_inspect_command(
    source: Path = typer.Argument(..., help="PPTX ou DOCX nativo a inspecionar."),
) -> None:
    """Emite evidência estrutural e, em PPTX, roles recuperadas após round-trip."""
    try:
        diagnostics = validate_ooxml(source)
        manifest = canonical_ooxml_manifest(source)
        shapes = inspect_semantic_shapes(source) if source.suffix.lower() == ".pptx" else []
    except _EXPECTED_ERRORS as error:
        _fail(error)
    typer.echo(
        json.dumps(
            {
                "packageType": manifest.package_type,
                "canonicalParts": len(manifest.part_hashes),
                "diagnostics": [
                    {
                        "code": item.code,
                        "severity": item.severity,
                        "message": item.message,
                        "part": item.part,
                    }
                    for item in diagnostics
                ],
                "semanticShapes": [
                    {
                        "role": shape.role,
                        "name": shape.name,
                        "kind": shape.kind,
                        "text": shape.text,
                        "fontFamily": shape.font_family,
                        "fontSizePt": shape.font_size_pt,
                        "color": shape.color,
                    }
                    for shape in shapes
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    if any(item.blocking for item in diagnostics):
        raise typer.Exit(code=3)


if __name__ == "__main__":  # pragma: no cover - entry point instalado cobre este caminho
    app()
