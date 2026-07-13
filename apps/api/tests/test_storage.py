import hashlib

import pytest

from brand_api.storage import Storage

HELLO_SHA = hashlib.sha256(b"hello").hexdigest()


def test_put_returns_sha_and_layout(tmp_path):
    st = Storage(tmp_path)
    sha = st.put(b"hello")
    assert sha == HELLO_SHA
    expected = tmp_path / "sha256" / sha[0:2] / sha[2:4] / sha
    assert expected.is_file()
    assert st.path_for(sha) == expected


def test_get_round_trip_and_has(tmp_path):
    st = Storage(tmp_path)
    sha = st.put(b"conteudo")
    assert st.has(sha) is True
    assert st.get(sha) == b"conteudo"
    assert st.has("0" * 64) is False


def test_get_missing_raises(tmp_path):
    st = Storage(tmp_path)
    with pytest.raises(KeyError):
        st.get("0" * 64)


def test_put_is_idempotent(tmp_path):
    st = Storage(tmp_path)
    a = st.put(b"x")
    b = st.put(b"x")
    assert a == b
    assert st.get(a) == b"x"


def test_blob_corrompido_e_recusado_e_reparado_pelo_put(tmp_path):
    st = Storage(tmp_path)
    path = st.path_for(HELLO_SHA)
    path.parent.mkdir(parents=True)
    path.write_bytes(b"bytes-impostores")

    assert st.has(HELLO_SHA) is False
    with pytest.raises(KeyError):
        st.get(HELLO_SHA)

    assert st.put(b"hello") == HELLO_SHA
    assert path.read_bytes() == b"hello"
    assert st.has(HELLO_SHA) is True


def test_blob_symlink_nao_e_seguido(tmp_path):
    st = Storage(tmp_path / "storage")
    path = st.path_for(HELLO_SHA)
    path.parent.mkdir(parents=True)
    external = tmp_path / "externo"
    external.write_bytes(b"hello")
    try:
        path.symlink_to(external)
    except OSError:
        pytest.skip("criação de symlink indisponível neste ambiente")

    assert st.has(HELLO_SHA) is False
    with pytest.raises(KeyError):
        st.get(HELLO_SHA)
    st.put(b"hello")
    assert external.read_bytes() == b"hello"
    assert not path.is_symlink()
    assert path.read_bytes() == b"hello"


def test_parent_symlink_nao_e_seguido_pelo_put(tmp_path):
    root = tmp_path / "storage"
    st = Storage(root)
    external = tmp_path / "externo"
    target = external / HELLO_SHA[:2] / HELLO_SHA[2:4] / HELLO_SHA
    target.parent.mkdir(parents=True)
    target.write_bytes(b"hello")
    try:
        (root / "sha256").symlink_to(external, target_is_directory=True)
    except OSError:
        pytest.skip("criação de symlink de diretório indisponível neste ambiente")

    assert st.has(HELLO_SHA) is False
    with pytest.raises(ValueError, match="link"):
        st.put(b"hello")
    assert target.read_bytes() == b"hello"
