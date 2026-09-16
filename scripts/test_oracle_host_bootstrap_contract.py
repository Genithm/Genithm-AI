from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLOUD_INIT = ROOT / "deploy/oracle/terraform/cloud-init.yaml.tftpl"
MAIN_TF = ROOT / "deploy/oracle/terraform/main.tf"


def test_cloud_init_installs_deployment_runtime() -> None:
    text = CLOUD_INIT.read_text(encoding="utf-8")
    for package in ("docker.io", "docker-compose-v2", "git", "python3"):
        assert f"  - {package}" in text


def test_worker_ssh_is_limited_to_api_subnet() -> None:
    text = MAIN_TF.read_text(encoding="utf-8")
    assert 'resource "oci_core_network_security_group_security_rule" "worker_ssh_from_api_subnet"' in text
    block = text.split('resource "oci_core_network_security_group_security_rule" "worker_ssh_from_api_subnet"', 1)[1]
    block = block.split('\n}\n', 1)[0]
    assert 'source                    = var.api_subnet_cidr' in block
    assert 'direction                 = "INGRESS"' in block
    assert 'min = 22' in block
    assert 'max = 22' in block
