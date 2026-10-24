#!/usr/bin/env python3
"""Local-only, fixed-target reverse proxy for the valid-app isolated smoke site.

Serves HTML/assets and proxies /__test_api__ to the exact test Apps Script URL
written into this generated bundle. It binds ONLY to 127.0.0.1 and logs
neither request/response bodies nor access keys.

Requires only Python's standard library.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
API_TARGET_FILE = HERE / "SMOKE_TEST_API_URL.txt"
ENDPOINT = "/__test_api__"
PORT = 8765
MAX_POST_BYTES = 25_000_000
EXPECTED_HOST = "script.google.com"
PRODUCTION_DEPLOYMENT = (
    "AKfycbwS_-ptDyhVk5yrNtRB8I32WUJen-xdjKUtp-Rf7Dbdhhg4V9Vw3gneD9K7ErZgP_Y"
)


def load_test_api_url() -> str:
    """Reject arbitrary proxy destinations and the production GAS deployment."""
    url = API_TARGET_FILE.read_text(encoding="utf-8").strip()
    parsed = urllib.parse.urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != EXPECTED_HOST
        or not re.fullmatch(r"/macros/s/[A-Za-z0-9_-]+/exec", parsed.path)
        or parsed.query
        or parsed.fragment
        or PRODUCTION_DEPLOYMENT in parsed.path
    ):
        raise ValueError("本番または不正なGAS URLを指定できません。")
    return url


class IsolatedHandler(SimpleHTTPRequestHandler):
    """Static files and a strict fixed-destination Apps Script relay."""

    test_api_url = ""
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def log_message(self, fmt, *args):
        # Never log request URLs (possibly sensitive query strings), body, or key.
        return

    def _reply(self, status: int, data: bytes, content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def _json_error(self, code: str, message: str, status=502):
        body = json.dumps(
            {"ok": False, "code": code, "message": message},
            ensure_ascii=False,
        ).encode("utf-8")
        self._reply(status, body)

    def _relay(self, *, is_post: bool):
        content = None
        if is_post:
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self._json_error("INVALID_POST_SIZE", "送信サイズが不正です。", 400)
            if size < 1 or size > MAX_POST_BYTES:
                return self._json_error("POST_SIZE_EXCEEDED", "送信サイズが上限外です。", 413)
            content = self.rfile.read(size)
            if len(content) != size:
                return self._json_error("INCOMPLETE_POST", "POST本文を最後まで読み込めませんでした。", 400)

        # No cookies, access tokens, user-supplied destination headers, or
        # arbitrary target URLs are forwarded. Only the exact configured GAS URL.
        headers = (
            {"Content-Type": "text/plain;charset=UTF-8"}
            if is_post else {}
        )
        request = urllib.request.Request(
            self.test_api_url, data=content, headers=headers,
            method="POST" if is_post else "GET"
        )
        try:
            with urllib.request.urlopen(request, timeout=350) as response:
                result = response.read(MAX_POST_BYTES + 1)
                if len(result) > MAX_POST_BYTES:
                    return self._json_error(
                        "API_RESPONSE_TOO_LARGE", "API応答が大きすぎます。"
                    )
                content_type = response.headers.get(
                    "Content-Type", "application/json; charset=utf-8"
                )
                return self._reply(200, result, content_type)
        except urllib.error.HTTPError as exc:
            # Do not include response body; Google may return an HTML error.
            return self._json_error(
                "REMOTE_HTTP_ERROR",
                f"テストGASのHTTP応答が{exc.code}でした。", 502
            )
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            # No URLs/keys or response data in printed messages.
            print(f"Test GAS request failed ({type(exc).__name__})", file=sys.stderr)
            return self._json_error(
                "REMOTE_CONNECTION_FAILED",
                "Pythonからテスト用GASへ接続できませんでした。", 502
            )

    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path == ENDPOINT:
            if self.path != ENDPOINT:
                return self._json_error("INVALID_API_PATH", "APIパスが不正です。", 400)
            return self._relay(is_post=False)
        return super().do_GET()

    def do_POST(self):
        if self.path != ENDPOINT:
            return self._json_error("INVALID_API_PATH", "許可されていないPOST先です。", 404)
        return self._relay(is_post=True)


def main():
    IsolatedHandler.test_api_url = load_test_api_url()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), IsolatedHandler)
    server.daemon_threads = True
    print("valid-app 差分更新テスト用サーバーを起動しました。")
    print(f"ブラウザ: http://localhost:{PORT}/index.html")
    print("接続先: テストGASのみ（認証キー・応募データはログに記録しません）")
    print("終了するには Ctrl+C を押してください。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
