import importlib.util
import io
import json
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('ai_preflight',ROOT/'scripts/check_ai_provider_models.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
from genithm_ai_worker.providers import ProviderHttpError, provider_configs_from_env

ENV={"GEMINI_API_KEY":"synthetic-google-secret", "GROQ_API_KEY":"synthetic-groq-secret"}
def providers(): return provider_configs_from_env(ENV)
class Response(io.BytesIO):
    def __exit__(self,*args): self.close()

def response(value): return Response(json.dumps(value).encode())

class PreflightTests(unittest.TestCase):
    def test_google_model_on_second_page_is_found(self):
        g,_=providers()
        pages=[response({'models':[{'name':'models/unrelated'}],'nextPageToken':'next page'}),
               response({'models':[{'name':'models/'+g.model}]})]
        with patch.object(m,'urlopen',side_effect=pages) as request:
            m.model_available(g)
            self.assertIn('pageToken=next+page',request.call_args.args[0].full_url)
            self.assertEqual(request.call_count,2)
            self.assertNotIn(g.api_key,request.call_args.args[0].full_url)

    def test_repeated_page_token_is_rejected(self):
        g,_=providers()
        with patch.object(m,'urlopen',side_effect=lambda *a,**k: response({'models':[],'nextPageToken':'same'})):
            with self.assertRaisesRegex(RuntimeError,'pagination'): m.model_available(g)

    def test_model_absent_is_not_silently_changed(self):
        g,_=providers()
        with patch.object(m,'urlopen',return_value=response({'models':[]})):
            with self.assertRaisesRegex(RuntimeError,'not listed'): m.model_available(g)

    def test_unknown_response_shape_fails_closed(self):
        g,_=providers()
        with patch.object(m,'urlopen',return_value=response({'models':{}})):
            with self.assertRaisesRegex(RuntimeError,'catalogue'): m.model_available(g)

    def test_auth_error_body_never_appears(self):
        g,_=providers()
        error=HTTPError('https://example.invalid',401,'raw '+g.api_key,{},io.BytesIO(b'private response body'))
        with patch.object(m,'urlopen',side_effect=error):
            with self.assertRaises(RuntimeError) as raised: m.model_available(g)
            self.assertIn('HTTP 401',str(raised.exception))
            self.assertNotIn(g.api_key,str(raised.exception))
            self.assertNotIn('private response',str(raised.exception))

    def test_oversized_catalogue_fails(self):
        g,_=providers()
        with patch.object(m,'urlopen',return_value=Response(b'x'*(m.MAX_BYTES+1))):
            with self.assertRaises(RuntimeError): m.model_available(g)

    def test_explicit_inference_checks_each_provider_independently(self):
        capture=io.StringIO()
        with patch.dict(os.environ,ENV,clear=True),patch.object(m,'model_available') as model,patch.object(m,'inference_probe',side_effect=lambda p:{'provider':p.name,'inference':'passed'}) as infer,redirect_stdout(capture):
            rows=m.run_checks(inference=True)
        self.assertEqual([x['provider'] for x in rows],['gemini','groq'])
        self.assertEqual(model.call_count,2)
        self.assertEqual(infer.call_count,2)
        for secret in ENV.values(): self.assertNotIn(secret,capture.getvalue())

    def test_default_discovery_does_not_spend_inference_quota(self):
        with patch.dict(os.environ,ENV,clear=True),patch.object(m,'model_available'),patch.object(m,'inference_probe') as infer,redirect_stdout(io.StringIO()):
            rows=m.run_checks()
        infer.assert_not_called()
        self.assertTrue(all(x['inference']=='not_tested' for x in rows))

    def test_missing_secondary_is_reported(self):
        with patch.dict(os.environ,{'GEMINI_API_KEY':'test'},clear=True):
            with self.assertRaisesRegex(RuntimeError,'GROQ_API_KEY'): m.run_checks()

    def test_inference_uses_real_adapter_validation(self):
        g,_=providers()
        with patch.object(m.OpenAICompatibleProvider,'structured_response',side_effect=ProviderHttpError('secret vendor message',retryable=False)):
            with self.assertRaises(RuntimeError) as raised: m.inference_probe(g)
        self.assertNotIn('secret vendor message',str(raised.exception))
        self.assertIn('complete valid result',str(raised.exception))

    def test_groq_headers_are_bearer_not_google_key(self):
        _,g=providers()
        with patch.object(m,'urlopen',return_value=response({'data':[{'id':g.model}]})) as request:
            m.model_available(g)
        self.assertEqual(request.call_args.args[0].get_header('Authorization'),'Bearer '+g.api_key)
        self.assertIsNone(request.call_args.args[0].get_header('X-goog-api-key'))

if __name__=='__main__': unittest.main()
