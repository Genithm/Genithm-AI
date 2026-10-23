import pytest
from genithm_ai_worker.providers import ProviderHttpError, ProviderRouter

class FakeProvider:
    def __init__(self,name,model,outcomes):
        self.name,self.model,self.outcomes,self.calls=name,model,list(outcomes),0
    def structured_response(self,**_kwargs):
        self.calls+=1
        value=self.outcomes.pop(0)
        if isinstance(value,Exception): raise value
        return value

def test_primary_provider_without_fallback():
    primary=FakeProvider("gemini","gemini-test",[{"ok":True}])
    backup=FakeProvider("groq","groq-test",[{"ok":True}])
    router=ProviderRouter(primary,backup)
    assert router.run(lambda p:p.structured_response())=={"ok":True}
    assert (primary.calls,backup.calls,router.last_provider)==(1,0,"gemini")

def test_transient_primary_failure_uses_groq():
    primary=FakeProvider("gemini","gemini-test",[ProviderHttpError("outage",retryable=True,fallback_allowed=True)])
    backup=FakeProvider("groq","groq-test",[{"ok":True}])
    router=ProviderRouter(primary,backup)
    assert router.run(lambda p:p.structured_response())=={"ok":True}
    assert (primary.calls,backup.calls,router.last_provider)==(1,1,"groq")
    assert router.last_model=="groq-test"

def test_refusal_is_not_bypassed_by_groq():
    primary=FakeProvider("gemini","gemini-test",[ProviderHttpError("refused",retryable=False,fallback_allowed=False)])
    backup=FakeProvider("groq","groq-test",[{"ok":True}])
    router=ProviderRouter(primary,backup)
    with pytest.raises(ProviderHttpError,match="refused"): router.run(lambda p:p.structured_response())
    assert backup.calls==0

def test_only_the_expected_provider_order_is_allowed():
    with pytest.raises(ValueError,match="Gemini"):
        ProviderRouter(FakeProvider("groq","a",[{}]),FakeProvider("gemini","b",[{}]))
