output "vcn_id" {
  value = oci_core_vcn.genithm.id
}

output "api_subnet_id" {
  value = oci_core_subnet.api.id
}

output "worker_subnet_id" {
  value = oci_core_subnet.workers.id
}

output "api_instance_id" {
  value = oci_core_instance.api.id
}

output "worker_instance_id" {
  value = oci_core_instance.workers.id
}

output "api_public_ip" {
  description = "Public IP assigned to the API host. Place Cloudflare/reverse-proxy controls in front before production exposure."
  value       = oci_core_instance.api.public_ip
}

output "worker_private_ip" {
  value = oci_core_instance.workers.private_ip
}
