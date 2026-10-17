import base64
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import shutil
import uuid

spec = importlib.util.spec_from_file_location("chrome_bridge", Path(__file__).with_name("chrome_bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
ALLOWED = {"browser_batch", "file_upload", "read_page"}


class ChromeBridgeTests(unittest.TestCase):
    def setUp(self):
        temp_base = Path(tempfile.gettempdir()).resolve()
        self.temp = temp_base / ("jarvis-chrome-test-" + uuid.uuid4().hex)
        self.temp.mkdir()
        assert self.temp.resolve().parent == temp_base
        self.addCleanup(shutil.rmtree, self.temp)
        self.root = self.temp / "shared"
        self.root.mkdir()
        self.pdf = self.root / "resume.pdf"
        self.pdf.write_bytes(b"%PDF-fixture")
        self.args = {"paths": [str(self.pdf)], "ref": "ref_7", "tabId": 12}

    def test_upload_uses_content_and_observed_target(self):
        name, args = bridge.transform_call("file_upload", self.args, [self.root], ALLOWED)
        self.assertEqual(name, "browser_batch")
        action = args["actions"][0]
        self.assertEqual(action["name"], "file_upload")
        payload = action["input"]
        self.assertNotIn("paths", payload)
        self.assertEqual((payload["ref"], payload["tabId"]), ("ref_7", 12))
        self.assertEqual(payload["files"][0]["name"], "resume.pdf")
        self.assertEqual(payload["files"][0]["mimeType"], "application/pdf")
        self.assertEqual(base64.b64decode(payload["files"][0]["data"]), self.pdf.read_bytes())

    def test_outside_relative_and_injected_content_are_rejected(self):
        outside = self.temp / "private.pdf"
        outside.write_bytes(b"private")
        cases = [{**self.args, "paths": [str(outside)]}, {**self.args, "paths": ["resume.pdf"]},
                 {**self.args, "files": [{"data": "injected", "name": "private.pdf"}]},
                 {**self.args, "tabId": True}, {**self.args, "paths": []}]
        for args in cases:
            with self.subTest(args=args), self.assertRaises(ValueError):
                bridge.transform_call("file_upload", args, [self.root], ALLOWED)

    def test_symlink_outside_shared_root_is_rejected(self):
        outside = self.temp / "private.pdf"
        outside.write_bytes(b"private")
        link = self.root / "linked.pdf"
        try:
            link.symlink_to(outside)
        except OSError:
            self.skipTest("Symlink creation is unavailable for this Windows user")
        with self.assertRaises(ValueError):
            bridge.transform_call("file_upload", {**self.args, "paths": [str(link)]}, [self.root], ALLOWED)

    def test_batch_translates_upload_and_rejects_disabled_nested_tools(self):
        actions = [{"name": "read_page", "input": {"tabId": 12}}, {"name": "file_upload", "input": self.args}]
        _, payload = bridge.transform_call("browser_batch", {"actions": actions}, [self.root], ALLOWED)
        self.assertEqual(payload["actions"][0], actions[0])
        self.assertIn("files", payload["actions"][1]["input"])
        for name in ("javascript_tool", "browser_batch", "unknown"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                bridge.transform_call("browser_batch", {"actions": [{"name": name, "input": {}}]}, [self.root], ALLOWED)

    def test_combined_size_limit_applies_before_forwarding(self):
        second = self.root / "second.pdf"
        second.write_bytes(b"%PDF-fixture")
        original = bridge.MAX_UPLOAD
        bridge.MAX_UPLOAD = 20
        self.addCleanup(setattr, bridge, "MAX_UPLOAD", original)
        with self.assertRaises(ValueError):
            bridge.transform_call("file_upload", {**self.args, "paths": [str(self.pdf), str(second)]}, [self.root], ALLOWED)
        with self.assertRaises(ValueError):
            bridge.transform_call("browser_batch", {"actions": [{"name": "file_upload", "input": self.args}] * 2}, [self.root], ALLOWED)

    def test_stdio_filters_catalog_and_preserves_permission_denial_without_retry(self):
        fake = self.temp / "fake.py"
        fake.write_text('''import sys,json
for line in sys.stdin:
 r=json.loads(line)
 if 'id' not in r:continue
 if r['method']=='tools/list':result={'tools':[{'name':n} for n in ['read_page','javascript_tool','file_upload']]}
 else:result={'isError':True,'content':[{'type':'text','text':'Site permission denied; stop.'}]}
 print(json.dumps({'jsonrpc':'2.0','id':r['id'],'result':result}),flush=True)
''', encoding="utf-8")
        module_path = str(Path(bridge.__file__).parent)
        code = ("import sys;sys.path.insert(0," + repr(module_path) + ");import chrome_bridge;"
                "chrome_bridge.run_bridge([sys.executable," + repr(str(fake)) + "],[],{'read_page','file_upload'})")
        requests = [{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
                    {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "read_page", "arguments": {"tabId": 12}}}]
        run = subprocess.run([sys.executable, "-c", code], input="".join(json.dumps(r)+"\n" for r in requests),
                             text=True, encoding="utf-8", capture_output=True, timeout=10)
        self.assertEqual(run.returncode, 0, run.stderr)
        replies = [json.loads(line) for line in run.stdout.splitlines()]
        self.assertEqual(len(replies), 2)
        self.assertEqual([t["name"] for t in replies[0]["result"]["tools"]], ["read_page", "file_upload"])
        self.assertEqual(replies[1]["result"], {"isError": True, "content": [{"type": "text", "text": "Site permission denied; stop."}]})


if __name__ == "__main__":
    unittest.main()
