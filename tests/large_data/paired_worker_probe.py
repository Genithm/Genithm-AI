"""Fresh isolated process measures the real paired worker (no live Supabase target)."""
import json, os, resource, time
from uuid import uuid4
from conftest import SqlGateway
from app.large_data.routes import Clients
from app.large_data.policy import LargeDataConfig
from app.large_data.storage import MultipartStorage
from app.large_data.paired_worker import process_pair
c=Clients(SqlGateway(url='http://127.0.0.1',publishable_key='unused',secret_key='unused'), MultipartStorage(
 LargeDataConfig('http://127.0.0.1:9000','http://127.0.0.1:9000',os.environ['GENITHM_TEST_BUCKET'],
 'genithm-ci','temporary-private-test-password',region='us-east-1',allow_loopback=True)))
t=time.perf_counter(); assert process_pair(c,str(uuid4()))
print(json.dumps({'paired_worker_seconds':time.perf_counter()-t,
 'peak_worker_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}))
