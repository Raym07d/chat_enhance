"""Client and Flask adapter regressions; run with python -B to avoid extension caches."""
import json
import sys
import types
import unittest
from contextlib import contextmanager
from pathlib import Path
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://chatgpt.com/c/test'
RESULT = {'html': '<!doctype html><p>你好</p>', 'filename': '对话.html', 'turns': 3, 'warnings': []}


def load(name):
    namespace = {'__name__': name}
    exec(compile((ROOT / 'examples' / (name + '.py.txt')).read_text(), name, 'exec'), namespace)
    return namespace


class PythonAPI(unittest.TestCase):
    def client(self, result=RESULT, export_error=None, close_code=None):
        module, closed = load('chat_enhance'), []

        @contextmanager
        def response(request, timeout):
            if '/json/close/' in request.full_url:
                closed.append(True)
                if close_code:
                    raise HTTPError(request.full_url, close_code, 'close failed', {}, None)
            yield types.SimpleNamespace(read=lambda: json.dumps({'id': 'owned', 'webSocketDebuggerUrl': 'ws://test'}).encode())

        class Socket:
            def send(self, data):
                self.request = json.loads(data)

            def recv(self, timeout):
                if export_error:
                    raise export_error
                value = True if 'typeof ' in self.request['params']['expression'] else result
                return json.dumps({'id': self.request['id'], 'result': {'result': {'value': value}}})

        @contextmanager
        def connection(*args, **kwargs):
            yield Socket()

        module.update(urlopen=response, connect=connection)
        return module['export_chatgpt'], closed

    def test_result_and_close(self):
        call, closed = self.client(close_code=404)
        self.assertEqual(call(URL, extension_id='a' * 32), RESULT)
        self.assertEqual(closed, [True])

    def test_timeout_is_not_masked_by_cleanup(self):
        call, closed = self.client(export_error=TimeoutError('export timed out'), close_code=503)
        with self.assertRaisesRegex(TimeoutError, 'export timed out'):
            call(URL, extension_id='a' * 32)
        self.assertEqual(closed, [True])

    def test_bad_input_and_result(self):
        call, closed = self.client(result={'html': 'incomplete'})
        with self.assertRaises(ValueError):
            call('https://example.com/c/test', extension_id='a' * 32)
        self.assertEqual(closed, [])
        with self.assertRaisesRegex(RuntimeError, '返回结果不完整'):
            call(URL, extension_id='a' * 32)
        self.assertEqual(closed, [True])

    def test_flask_download_errors_and_lock_release(self):
        from flask import Flask
        fake = types.ModuleType('chat_enhance')
        fake.export_chatgpt = lambda *args, **kwargs: dict(RESULT)
        previous = sys.modules.get('chat_enhance')
        sys.modules['chat_enhance'] = fake
        try:
            adapter = load('flask_export')
        finally:
            if previous is None:
                del sys.modules['chat_enhance']
            else:
                sys.modules['chat_enhance'] = previous
        app = Flask(__name__)
        app.config['CHAT_ENHANCE_EXTENSION_ID'] = 'a' * 32
        app.register_blueprint(adapter['chat_exports'])
        client = app.test_client()
        self.assertEqual(client.post('/api/chatgpt/export', json=[]).status_code, 400)
        response = client.post('/api/chatgpt/export', json={'url': URL})
        self.assertEqual(response.data.decode(), RESULT['html'])
        self.assertIn('attachment', response.headers['Content-Disposition'])
        self.assertEqual(response.headers['X-Chat-Enhance-Turns'], '3')
        for exception, code in [(TimeoutError(), 504), (OSError(), 503), (RuntimeError('failed'), 502), (ValueError('bad URL'), 400)]:
            def fail(*args, **kwargs):
                raise exception
            adapter['export_chatgpt'] = fail
            self.assertEqual(client.post('/api/chatgpt/export', json={'url': URL}).status_code, code)
            self.assertFalse(adapter['export_lock'].locked())


if __name__ == '__main__':
    unittest.main()
