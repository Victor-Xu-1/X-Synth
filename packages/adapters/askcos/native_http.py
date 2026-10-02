"""Bounded local native HTTP; service outages must not turn into chemical scores."""

import requests


class NativeProtocolError(RuntimeError):
    pass


class NativeSession(requests.Session):
    def __init__(self):
        super().__init__()
        self.trust_env = False

    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", (3, 120))
        kwargs.setdefault("allow_redirects", False)
        response = super().request(method, url, **kwargs)
        response.raise_for_status()
        if 300 <= response.status_code < 400:
            raise requests.HTTPError(
                "Native service redirects are not permitted", response=response
            )
        return response


def post_json(session, url, *, payload, response_model=None, timeout=None):
    kwargs = {"json": payload}
    if timeout is not None:
        kwargs["timeout"] = timeout
    data = session.post(url, **kwargs).json()
    if not isinstance(data, dict) or data.get("status_code") != 200:
        raise NativeProtocolError("Native service returned a failed envelope")
    if response_model is not None:
        response_model(**data)
    return data
