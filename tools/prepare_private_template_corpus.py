"""Prepara sequências raster privadas para o laboratório de referências."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import unicodedata
from pathlib import Path

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
SCHEMA_VERSION = "0.1.0"


def _slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii").casefold()
    compact = re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")
    if len(compact) < 2:
        raise ValueError(f"O nome {value!r} não produz um id portável.")
    return compact[:96].rstrip("-")


def _natural_key(path: Path) -> tuple[object, ...]:
    return tuple(
        int(part) if part.isdigit() else part.casefold()
        for part in re.split(r"(\d+)", path.name)
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def _media_type(path: Path) -> str:
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }[path.suffix.casefold()]


def _image_inventory(source: Path) -> list[tuple[Path, list[Path]]]:
    groups: list[tuple[Path, list[Path]]] = []
    for directory in sorted(
        (
            item
            for item in source.iterdir()
            if item.is_dir() and not item.name.startswith(".")
        ),
        key=lambda item: item.name.casefold(),
    ):
        files = sorted(
            (
                item
                for item in directory.iterdir()
                if item.is_file() and item.suffix.casefold() in IMAGE_SUFFIXES
            ),
            key=_natural_key,
        )
        if files:
            groups.append((directory, files))
    if not groups:
        raise ValueError("Nenhuma sequência de imagens foi encontrada.")
    return groups


def _holdout_ids(slugs: list[str], ratio: float) -> set[str]:
    count = max(1, min(len(slugs) - 1, round(len(slugs) * ratio)))
    ranked = sorted(
        slugs,
        key=lambda item: hashlib.sha256(f"molda-holdout:{item}".encode()).digest(),
    )
    return set(ranked[:count])


def _verify_and_copy(images: list[Path], destination: Path) -> list[Path]:
    from PIL import Image

    copied: list[Path] = []
    for index, source in enumerate(images, start=1):
        suffix = source.suffix.casefold()
        target = destination / f"slide-{index:03d}{suffix}"
        with Image.open(source) as image:
            image.load()
            width, height = image.size
            if width <= 0 or height <= 0 or abs(width / height - 0.8) > 0.015:
                raise ValueError(
                    f"{source} precisa ser uma imagem 4:5; recebido {width}x{height}."
                )
        shutil.copyfile(source, target)
        copied.append(target)
    return copied


def _contact_sheet(images: list[Path], target: Path) -> None:
    from PIL import Image, ImageOps

    columns = 5
    tile_width, tile_height = 216, 270
    rows = math.ceil(len(images) / columns)
    sheet = Image.new("RGB", (columns * tile_width, rows * tile_height), "#ece9e1")
    for index, path in enumerate(images):
        with Image.open(path) as image:
            tile = ImageOps.fit(
                image.convert("RGB"),
                (tile_width, tile_height),
                method=Image.Resampling.LANCZOS,
            )
        x = (index % columns) * tile_width
        y = (index // columns) * tile_height
        sheet.paste(tile, (x, y))
    sheet.save(target, format="PNG", optimize=True)


def _file_record(path: Path, role: str) -> dict[str, object]:
    return {
        "path": path.name,
        "role": role,
        "mediaType": _media_type(path),
        "size": path.stat().st_size,
        "sha256": _sha256(path),
    }


def _load_annotations(paths: list[Path] | None) -> dict[str, dict[str, object]]:
    annotations: dict[str, dict[str, object]] = {}
    for path in paths or []:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict) or not all(
            isinstance(key, str) and isinstance(value, dict)
            for key, value in raw.items()
        ):
            raise ValueError(
                "O arquivo de anotações precisa ser um objeto indexado pelo id."
            )
        duplicates = set(annotations) & set(raw)
        if duplicates:
            raise ValueError(
                "Há anotações repetidas em mais de um arquivo: "
                + ", ".join(sorted(duplicates))
            )
        annotations.update(raw)
    return annotations


def _prepare_output(output: Path, *, replace: bool) -> None:
    if not output.exists():
        output.mkdir(parents=True)
        return
    marker = output / "template-corpus.json"
    if not replace:
        raise ValueError(
            "O destino já existe. Use --replace para recriar o corpus gerado."
        )
    if not marker.is_file():
        raise ValueError("O destino existente não tem o marcador template-corpus.json.")
    shutil.rmtree(output)
    output.mkdir(parents=True)


def prepare(
    source: Path,
    output: Path,
    *,
    author: str,
    owner: str,
    corpus_id: str,
    title: str,
    holdout_ratio: float,
    annotations_paths: list[Path] | None,
    replace: bool,
) -> dict[str, object]:
    source = source.resolve(strict=True)
    output = output.resolve()
    if not source.is_dir():
        raise ValueError("A origem precisa ser uma pasta.")
    if output == source:
        raise ValueError("Origem e destino precisam ser diferentes.")
    groups = _image_inventory(source)
    slugs = [_slug(directory.name) for directory, _files in groups]
    if len(slugs) != len(set(slugs)):
        raise ValueError("Duas pastas produzem o mesmo id portável.")
    holdouts = _holdout_ids(slugs, holdout_ratio)
    annotations = _load_annotations(annotations_paths)
    unknown_annotations = set(annotations) - set(slugs)
    if unknown_annotations:
        raise ValueError(
            "Há anotações para ids desconhecidos: "
            + ", ".join(sorted(unknown_annotations))
        )

    _prepare_output(output, replace=replace)
    references_root = output / "references"
    references_root.mkdir()
    references: list[str] = []
    from PIL import Image

    for (source_directory, source_images), slug in zip(groups, slugs, strict=True):
        reference_dir = references_root / slug
        reference_dir.mkdir()
        copied = _verify_and_copy(source_images, reference_dir)
        preview = reference_dir / "preview.png"
        with Image.open(copied[0]) as first:
            first.convert("RGB").save(preview, format="PNG", optimize=True)
        contact_sheet = reference_dir / "contact-sheet.png"
        _contact_sheet(copied, contact_sheet)
        annotation = annotations.get(slug, {})
        purposes = annotation.get(
            "purposes",
            ["sequência de conteúdo", "referência de composição"],
        )
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "id": slug,
            "titlePt": annotation.get("titlePt", source_directory.name),
            "intent": "holdout" if slug in holdouts else "reference",
            "provenance": {
                "author": author,
                "ownership": "authored",
                "usagePolicy": "derivative-authoring",
                "notesPt": "Material privado. Não redistribuir nem publicar como template bruto.",
            },
            "purposes": purposes,
            "profiles": ["post-4x5"],
            "files": [
                _file_record(preview, "preview"),
                _file_record(contact_sheet, "source"),
                *(_file_record(path, "source") for path in copied),
            ],
            "grammar": annotation.get("grammar"),
        }
        manifest_path = reference_dir / "template-reference.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        references.append(manifest_path.relative_to(output).as_posix())

    root = {
        "schemaVersion": SCHEMA_VERSION,
        "id": corpus_id,
        "titlePt": title,
        "owner": owner,
        "references": references,
    }
    (output / "template-corpus.json").write_text(
        json.dumps(root, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "groups": len(groups),
        "images": sum(len(files) for _directory, files in groups),
        "trainingGroups": len(groups) - len(holdouts),
        "holdoutGroups": len(holdouts),
        "holdoutIds": sorted(holdouts),
        "output": str(output),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepara sequências 4:5 privadas para o Template Corpus Lab."
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--author", required=True)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--corpus-id", default="molda-private-corpus")
    parser.add_argument("--title", default="Corpus privado de composições")
    parser.add_argument("--holdout-ratio", type=float, default=0.25)
    parser.add_argument(
        "--annotations",
        type=Path,
        action="append",
        help="JSON de anotações. Repita a opção para combinar arquivos sem ids duplicados.",
    )
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    if not 0 < args.holdout_ratio < 0.5:
        parser.error("--holdout-ratio precisa estar entre 0 e 0.5.")
    try:
        result = prepare(
            args.source,
            args.output,
            author=args.author,
            owner=args.owner,
            corpus_id=_slug(args.corpus_id),
            title=args.title,
            holdout_ratio=args.holdout_ratio,
            annotations_paths=args.annotations,
            replace=args.replace,
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
