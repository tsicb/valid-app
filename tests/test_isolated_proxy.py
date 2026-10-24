"""Isolated localhost proxy safety tests (no internet connection)."""
import io
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "isolated_smoke", ROOT / "scripts/serve-isolated-smoke.py"
)
proxy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proxy)


class Response:
    headers = {"Content-Type": "application/json"}
    def __init__(self, data):
        self.data = data

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, max_bytes):
        return self.data[:max_bytes]


class IsolatedProxyTests(unittest.TestCase):
    TEST_URL = "https://script.google.com/macros/s/TESTGASSCRIPT123456789/exec"

    def test_only_test_gas_is_valid_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "target.txt"
            with mock.patch.object(proxy, "API_TARGET_FILE", path):
                path.write_text(self.TEST_URL + "\n", encoding="utf-8")
                self.assertEqual(proxy.load_test_api_url(), self.TEST_URL)
                for url in (
                    "https://example.com/api",
                    "https://script.google.com/macros/s/"
                    + proxy.PRODUCTION_DEPLOYMENT + "/exec",
                    "http://script.google.com/macros/s/TESTGASSCRIPT123456789/exec",
                    "https://script.google.com/macros/s/TESTGASSCRIPT123456789/exec?other=1",
                ):
                    with self.subTest(url=url):
                        path.write_text(url, encoding="utf-8")
                        with self.assertRaises(ValueError):
                            proxy.load_test_api_url()

    def test_post_is_forwarded_to_fixed_target_without_browser_cors(self):
        body = json.dumps({
            "action": "manageAuthCheck",
            "accessKey": "FAKE_TEST_ONLY_KEY_DO_NOT_LOG",
        }).encode()
        handler = object.__new__(proxy.IsolatedHandler)
        handler.test_api_url = self.TEST_URL
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        handler.wfile = io.BytesIO()
        statuses = []
        handler.send_response = statuses.append
        handler.send_header = lambda *args: None
        handler.end_headers = lambda: None
        with mock.patch.object(proxy.urllib.request, "urlopen",
                               return_value=Response(b'{"ok":true}')) as outgoing:
            handler._relay(is_post=True)
        call = outgoing.call_args.args[0]
        self.assertEqual(call.full_url, self.TEST_URL)
        self.assertEqual(call.get_method(), "POST")
        self.assertEqual(call.data, body)
        self.assertEqual(
            call.headers["Content-type"], "text/plain;charset=UTF-8"
        )
        self.assertEqual(statuses, [200])
        self.assertEqual(handler.wfile.getvalue(), b'{"ok":true}')

    def test_invalid_body_size_is_rejected_before_outbound_network(self):
        handler = object.__new__(proxy.IsolatedHandler)
        handler.test_api_url = self.TEST_URL
        handler.headers = {"Content-Length": "25000001"}
        handler.rfile = io.BytesIO()
        handler.wfile = io.BytesIO()
        statuses = []
        handler.send_response = statuses.append
        handler.send_header = lambda *args: None
        handler.end_headers = lambda: None
        with mock.patch.object(proxy.urllib.request, "urlopen") as outgoing:
            handler._relay(is_post=True)
            outgoing.assert_not_called()
        self.assertEqual(statuses, [413])

    def test_server_is_loopback_only(self):
        src = (ROOT / "scripts/serve-isolated-smoke.py").read_text(
            encoding="utf-8"
        )
        self.assertIn('ThreadingHTTPServer(("127.0.0.1", PORT)', src)
        self.assertNotIn("0.0.0.0", src)


if __name__ == "__main__":
    unittest.main()
