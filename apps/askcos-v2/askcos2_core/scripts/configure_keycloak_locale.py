import json
import os
from pathlib import Path
import ssl
import urllib.error
import urllib.parse
import urllib.request


KEYCLOAK_BASE_URL = (
    os.environ.get("KEYCLOAK_BASE_URL")
    or os.environ.get("KEYCLOAK_SERVER_URL")
    or "https://127.0.0.1:8443/auth"
).rstrip("/")
ADMIN_USERNAME = os.environ.get("KEYCLOAK_ADMIN_USERNAME") or "admin"
ADMIN_PASSWORD = os.environ.get("KEYCLOAK_ADMIN_PASSWORD") or "admin"
ADMIN_LOCALE = os.environ.get("KEYCLOAK_ADMIN_LOCALE") or "zh-CN"
ADMIN_MESSAGE_OVERRIDES_PATH = Path(
    os.environ.get("KEYCLOAK_ADMIN_MESSAGE_OVERRIDES_PATH")
    or Path(__file__).resolve().parents[1] / "configs" / "keycloak_admin_zh_cn_overrides.json"
)
ADMIN_DISPLAY_OVERRIDES_PATH = Path(
    os.environ.get("KEYCLOAK_ADMIN_DISPLAY_OVERRIDES_PATH")
    or Path(__file__).resolve().parents[1] / "configs" / "keycloak_admin_display_overrides.json"
)
VERIFY_SSL = os.environ.get("KEYCLOAK_VERIFY_SSL", "false").lower() == "true"
SSL_CONTEXT = None if VERIFY_SSL else ssl._create_unverified_context()


def request_json(url, token=None, method="GET", data=None):
    body = None
    headers = {}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request, context=SSL_CONTEXT, timeout=30) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload) if payload else {}


def request_text(url, token, method="PUT", data=""):
    request = urllib.request.Request(
        url,
        data=data.encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "text/plain; charset=UTF-8",
        },
        method=method,
    )
    with urllib.request.urlopen(request, context=SSL_CONTEXT, timeout=30):
        return None


def admin_token():
    body = urllib.parse.urlencode(
        {
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(request, context=SSL_CONTEXT, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))["access_token"]


def configure_master_realm(token):
    realm_url = f"{KEYCLOAK_BASE_URL}/admin/realms/master"
    realm = request_json(realm_url, token=token)
    realm["internationalizationEnabled"] = True
    realm["supportedLocales"] = [ADMIN_LOCALE]
    realm["defaultLocale"] = ADMIN_LOCALE
    request_json(realm_url, token=token, method="PUT", data=realm)


def configure_admin_user(token):
    users_url = (
        f"{KEYCLOAK_BASE_URL}/admin/realms/master/users?"
        f"username={urllib.parse.quote(ADMIN_USERNAME)}"
    )
    users = request_json(users_url, token=token)
    admin_user = next(user for user in users if user.get("username") == ADMIN_USERNAME)
    user_url = f"{KEYCLOAK_BASE_URL}/admin/realms/master/users/{admin_user['id']}"
    full_user = request_json(user_url, token=token)
    attributes = dict(full_user.get("attributes") or {})
    attributes["locale"] = [ADMIN_LOCALE]
    full_user["attributes"] = attributes
    request_json(user_url, token=token, method="PUT", data=full_user)


def configure_admin_message_overrides(token):
    if not ADMIN_MESSAGE_OVERRIDES_PATH.exists():
        raise SystemExit(
            "Unable to configure Keycloak admin messages: "
            f"{ADMIN_MESSAGE_OVERRIDES_PATH} does not exist"
        )

    message_overrides = json.loads(ADMIN_MESSAGE_OVERRIDES_PATH.read_text(encoding="utf-8"))
    for key, value in message_overrides.items():
        localization_url = (
            f"{KEYCLOAK_BASE_URL}/admin/realms/master/localization/"
            f"{urllib.parse.quote(ADMIN_LOCALE, safe='')}/{urllib.parse.quote(key, safe='')}"
        )
        request_text(localization_url, token=token, data=value)


def find_named_item(items, field, value):
    return next(item for item in items if item.get(field) == value)


def configure_client_display_overrides(token, clients):
    for client_id, updates in clients.items():
        clients_url = (
            f"{KEYCLOAK_BASE_URL}/admin/realms/master/clients?"
            f"clientId={urllib.parse.quote(client_id)}"
        )
        client = find_named_item(request_json(clients_url, token=token), "clientId", client_id)
        client_url = f"{KEYCLOAK_BASE_URL}/admin/realms/master/clients/{client['id']}"
        full_client = request_json(client_url, token=token)
        full_client.update(updates)
        request_json(client_url, token=token, method="PUT", data=full_client)


def configure_client_scope_display_overrides(token, client_scopes):
    client_scopes_url = f"{KEYCLOAK_BASE_URL}/admin/realms/master/client-scopes"
    existing_client_scopes = request_json(client_scopes_url, token=token)
    for name, updates in client_scopes.items():
        client_scope = find_named_item(existing_client_scopes, "name", name)
        client_scope_url = f"{client_scopes_url}/{client_scope['id']}"
        full_client_scope = request_json(client_scope_url, token=token)
        full_client_scope.update(updates)
        request_json(client_scope_url, token=token, method="PUT", data=full_client_scope)


def configure_authentication_flow_display_overrides(token, authentication_flows):
    flows_url = f"{KEYCLOAK_BASE_URL}/admin/realms/master/authentication/flows"
    existing_flows = request_json(flows_url, token=token)
    for alias, updates in authentication_flows.items():
        flow = find_named_item(existing_flows, "alias", alias)
        flow.update(updates)
        flow_url = f"{flows_url}/{flow['id']}"
        request_json(flow_url, token=token, method="PUT", data=flow)


def configure_admin_display_overrides(token):
    if not ADMIN_DISPLAY_OVERRIDES_PATH.exists():
        raise SystemExit(
            "Unable to configure Keycloak admin display values: "
            f"{ADMIN_DISPLAY_OVERRIDES_PATH} does not exist"
        )

    display_overrides = json.loads(ADMIN_DISPLAY_OVERRIDES_PATH.read_text(encoding="utf-8"))
    configure_client_display_overrides(token, display_overrides.get("clients", {}))
    configure_client_scope_display_overrides(token, display_overrides.get("clientScopes", {}))
    configure_authentication_flow_display_overrides(
        token,
        display_overrides.get("authenticationFlows", {}),
    )


def main():
    try:
        token = admin_token()
        configure_master_realm(token)
        configure_admin_user(token)
        configure_admin_message_overrides(token)
        configure_admin_display_overrides(token)
    except urllib.error.URLError as exc:
        raise SystemExit(f"Unable to configure Keycloak locale: {exc}") from exc

    print(f"Configured Keycloak admin console locale: {ADMIN_LOCALE}")


if __name__ == "__main__":
    main()
