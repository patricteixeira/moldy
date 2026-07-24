import hashlib
import io
import zipfile

import pytest

from brand_api.unzip import UnzipError, safe_unpack


def _zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_unpacks_and_hashes(tmp_path):
    data = _zip({"manual.pdf": b"%PDF-1.4 fake", "assets/logos/logo.svg": b"<svg/>"})
    result = safe_unpack(data, tmp_path / "pkg")
    assert (tmp_path / "pkg" / "manual.pdf").read_bytes() == b"%PDF-1.4 fake"
    assert (tmp_path / "pkg" / "assets" / "logos" / "logo.svg").is_file()
    assert result.manifest["manual.pdf"] == hashlib.sha256(b"%PDF-1.4 fake").hexdigest()
    assert set(result.manifest) == {"manual.pdf", "assets/logos/logo.svg"}


def test_unpacks_from_seekable_stream_without_copying_the_archive(tmp_path):
    source = io.BytesIO(_zip({"manual.pdf": b"%PDF-1.4 fake"}))

    result = safe_unpack(source, tmp_path / "pkg")

    assert result.manifest["manual.pdf"] == hashlib.sha256(b"%PDF-1.4 fake").hexdigest()
    assert source.closed is False


def test_ignores_disallowed_extensions(tmp_path):
    data = _zip({"manual.pdf": b"x", "malware.exe": b"MZ"})
    result = safe_unpack(data, tmp_path / "pkg")
    assert result.ignored == ["malware.exe"]
    assert not (tmp_path / "pkg" / "malware.exe").exists()


def test_rejects_traversal(tmp_path):
    data = _zip({"../evil.txt": b"x"})
    with pytest.raises(UnzipError):
        safe_unpack(data, tmp_path / "pkg")
    assert not (tmp_path / "evil.txt").exists()


def test_rejects_absolute_and_backslash_traversal(tmp_path):
    for name in ["C:/evil.json", "/etc/evil.json", "a\\..\\evil.json"]:
        with pytest.raises(UnzipError):
            safe_unpack(_zip({name: b"x"}), tmp_path / ("pkg-" + name[:1]))


def test_rejects_not_a_zip(tmp_path):
    with pytest.raises(UnzipError) as exc:
        safe_unpack(b"isto nao e zip", tmp_path / "pkg")
    assert "ZIP" in str(exc.value)


def test_rejects_too_many_entries(tmp_path):
    data = _zip({f"f{i}.json": b"{}" for i in range(11)})
    with pytest.raises(UnzipError):
        safe_unpack(data, tmp_path / "pkg", max_entries=10)


def test_rejects_unpacked_size_bomb(tmp_path):
    data = _zip({"big.json": b"0" * 4096})
    with pytest.raises(UnzipError):
        safe_unpack(data, tmp_path / "pkg", max_unpacked_bytes=1024)


@pytest.mark.parametrize(
    "name",
    [
        "CON.json",
        "dir/aux.txt",
        "asset.json:stream",
        "trailing.json.",
        "trailing.json ",
    ],
)
def test_rejects_nomes_perigosos_no_windows(tmp_path, name):
    destination = tmp_path / "pkg"
    with pytest.raises(UnzipError, match="caminhos"):
        safe_unpack(_zip({name: b"x"}), destination)
    assert not destination.exists()


def test_rejects_duplicata_pela_chave_normalizada_do_filesystem(tmp_path):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("A\\b.json", b"primeiro")
        archive.writestr("a/b.json", b"segundo")
    destination = tmp_path / "pkg"
    with pytest.raises(UnzipError, match="caminhos"):
        safe_unpack(buffer.getvalue(), destination)
    assert not destination.exists()
