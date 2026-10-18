"""Fresh-process worker measurement used by the isolated 1 GiB end-to-end test."""
import json,os,resource,time
from uuid import uuid4
from conftest import SqlGateway
from app.large_data.routes import Clients
from app.large_data.storage import MultipartStorage
from app.large_data.policy import LargeDataConfig
from app.large_data.worker import process_one
config=LargeDataConfig('http://127.0.0.1:9000','http://127.0.0.1:9000',os.environ['GENITHM_TEST_BUCKET'],
 'genithm-ci','temporary-private-test-password',region='us-east-1',allow_loopback=True)
c=Clients(SqlGateway(url='http://127.0.0.1',publishable_key='unused',secret_key='unused'),MultipartStorage(config))
worker=str(uuid4());universal=os.getenv("GENITHM_TEST_UNIVERSAL")=="1"
if universal:c.rpc("heartbeat_file_v47",p_worker=worker,p_storage=config.identity)
start=time.perf_counter();worked=process_one(c,worker,universal=universal)
assert worked, "The fresh worker did not claim a file"
print(json.dumps({'elapsed_seconds':time.perf_counter()-start,'peak_worker_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}))
