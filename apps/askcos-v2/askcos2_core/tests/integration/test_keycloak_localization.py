import json
import os
import ssl
import urllib.parse
import urllib.request

import pytest


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_KEYCLOAK_INTEGRATION") != "1",
    reason="Set RUN_KEYCLOAK_INTEGRATION=1 to verify a running Keycloak instance.",
)


KEYCLOAK_BASE_URL = os.environ.get(
    "KEYCLOAK_BASE_URL",
    "https://127.0.0.1:8443/auth",
).rstrip("/")
KEYCLOAK_ADMIN_USERNAME = os.environ.get("KEYCLOAK_ADMIN_USERNAME") or "admin"
KEYCLOAK_ADMIN_PASSWORD = os.environ.get("KEYCLOAK_ADMIN_PASSWORD") or "admin"
ADMIN_LOCALE = "zh-CN"
SSL_CONTEXT = ssl._create_unverified_context()
EXPECTED_ADMIN_MESSAGES = {
    "client_account": "账户",
    "client_account-console": "账户控制台",
    "client_admin-cli": "管理 CLI",
    "client_broker": "身份代理",
    "client_security-admin-console": "安全管理控制台",
    "currentRealm": "当前领域",
    "joinCommunity": "加入社区",
    "loggedInAsTempAdminUser": (
        "您当前使用的是临时管理员账户。为提高安全性，请创建一个永久管理员账户，"
        "然后删除该临时账户。"
    ),
    "manageRealms": "管理领域",
    "readBlog": "阅读博客",
    "emptyUserEvents": "无用户事件",
    "emptyUserEventsInstructions": "此领域中没有用户事件。",
    "flow.firstBrokerLogin": "首次代理登录流程",
    "savingUserEventsOff": "用户事件保存已关闭",
    "searchType.default": "默认搜索",
    "temporaryAdmin": "临时管理员账户。请尽快将其替换为永久管理员账户。",
    "temporaryService": "临时管理员服务账户。请尽快将其替换为永久管理员服务账户。",
    "viewDocumentation": "查看文档",
    "viewGuides": "查看指南",
    "welcome": "欢迎使用",
    "welcomeTabTitle": "欢迎",
    "welcomeText": (
        "Keycloak 提供用户联合、强认证、用户管理、细粒度授权等能力。"
        "它可以用最少的工作量为应用添加认证并保护服务，"
        "无需自行处理用户存储或用户认证。Keycloak 已经具备这些能力。"
    ),
    "welcomeTo": "欢迎使用 {{realmDisplayInfo}}",
}
EXPECTED_CLIENT_NAMES = {
    "account": "账户",
    "account-console": "账户控制台",
    "admin-cli": "管理 CLI",
    "broker": "身份代理",
    "master-realm": "master 领域",
    "security-admin-console": "安全管理控制台",
}
EXPECTED_CLIENT_SCOPE_DESCRIPTIONS = {
    "acr": "用于向令牌添加 acr（认证上下文类引用）的 OpenID Connect 范围",
    "address": "OpenID Connect 内置范围：地址",
    "basic": "用于向令牌添加所有基础声明的 OpenID Connect 范围",
    "email": "OpenID Connect 内置范围：电子邮箱",
    "microprofile-jwt": "MicroProfile JWT 内置范围",
    "offline_access": "OpenID Connect 内置范围：离线访问",
    "organization": "主体所属组织的附加声明",
    "phone": "OpenID Connect 内置范围：电话",
    "profile": "用于向令牌添加所有基础声明的 OpenID Connect 范围",
    "role_list": "SAML 角色列表",
}
EXPECTED_AUTHENTICATION_FLOW_DESCRIPTIONS = {
    "first broker login": (
        "首次通过身份供应商登录后执行的操作，此时身份供应商账户尚未关联到任何 Keycloak 账户。"
    ),
}


def _request_json(url, token=None, method="GET", data=None):
    body = None
    headers = {}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request, context=SSL_CONTEXT, timeout=20) as response:
        return json.loads(response.read().decode("utf-8") or "{}")


def _admin_token():
    data = urllib.parse.urlencode(
        {
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": KEYCLOAK_ADMIN_USERNAME,
            "password": KEYCLOAK_ADMIN_PASSWORD,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(request, context=SSL_CONTEXT, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))["access_token"]


def test_master_admin_console_defaults_to_simplified_chinese():
    token = _admin_token()
    realm = _request_json(f"{KEYCLOAK_BASE_URL}/admin/realms/master", token=token)
    users = _request_json(
        f"{KEYCLOAK_BASE_URL}/admin/realms/master/users?username={KEYCLOAK_ADMIN_USERNAME}",
        token=token,
    )
    admin_user = next(user for user in users if user["username"] == KEYCLOAK_ADMIN_USERNAME)

    assert realm["internationalizationEnabled"] is True
    assert realm["defaultLocale"] == ADMIN_LOCALE
    assert ADMIN_LOCALE in realm["supportedLocales"]
    assert admin_user.get("attributes", {}).get("locale") == [ADMIN_LOCALE]


def test_master_admin_console_uses_chinese_text_for_reachable_admin_messages():
    messages = _request_json(f"{KEYCLOAK_BASE_URL}/resources/master/admin/{ADMIN_LOCALE}")
    values_by_key = {message["key"]: message["value"] for message in messages}

    for key, expected_value in EXPECTED_ADMIN_MESSAGES.items():
        assert values_by_key[key] == expected_value


def test_master_builtin_admin_clients_use_chinese_display_names():
    token = _admin_token()
    messages = _request_json(f"{KEYCLOAK_BASE_URL}/resources/master/admin/{ADMIN_LOCALE}")
    values_by_key = {message["key"]: message["value"] for message in messages}

    for client_id, expected_name in EXPECTED_CLIENT_NAMES.items():
        clients = _request_json(
            f"{KEYCLOAK_BASE_URL}/admin/realms/master/clients?"
            f"clientId={urllib.parse.quote(client_id)}",
            token=token,
        )
        client = next(client for client in clients if client["clientId"] == client_id)
        raw_name = client["name"]
        if raw_name.startswith("${") and raw_name.endswith("}"):
            raw_name = values_by_key[raw_name[2:-1]]

        assert raw_name == expected_name


def test_master_builtin_client_scope_descriptions_are_chinese():
    token = _admin_token()
    client_scopes = _request_json(
        f"{KEYCLOAK_BASE_URL}/admin/realms/master/client-scopes",
        token=token,
    )
    client_scopes_by_name = {client_scope["name"]: client_scope for client_scope in client_scopes}

    for name, expected_description in EXPECTED_CLIENT_SCOPE_DESCRIPTIONS.items():
        assert client_scopes_by_name[name]["description"] == expected_description


def test_master_builtin_authentication_flow_descriptions_are_chinese():
    token = _admin_token()
    flows = _request_json(
        f"{KEYCLOAK_BASE_URL}/admin/realms/master/authentication/flows",
        token=token,
    )
    flows_by_alias = {flow["alias"]: flow for flow in flows}

    for alias, expected_description in EXPECTED_AUTHENTICATION_FLOW_DESCRIPTIONS.items():
        assert flows_by_alias[alias]["description"] == expected_description
