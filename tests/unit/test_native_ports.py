import socket

import pytest

from packages.platform.native_runtime import ensure_port_available


def test_preflight_rejects_a_real_listener_but_allows_closed_connections():
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        listener.listen()
        with pytest.raises(OSError):
            ensure_port_available(port)
        with socket.create_connection(("127.0.0.1", port)) as client:
            peer, _ = listener.accept()
            with peer:
                peer.shutdown(socket.SHUT_WR)
                assert client.recv(1) == b""
    ensure_port_available(port)
