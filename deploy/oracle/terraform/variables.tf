variable "region" {
  description = "OCI region for the V1 deployment."
  type        = string
}

variable "compartment_ocid" {
  description = "OCI compartment OCID that will own the Genithm resources."
  type        = string
}

variable "availability_domain" {
  description = "Availability domain used for both V1 compute instances."
  type        = string
}

variable "image_ocid" {
  description = "Validated OCI image OCID compatible with both selected compute shapes."
  type        = string
}

variable "ssh_authorized_key" {
  description = "Public SSH key installed by cloud-init. This is not a private secret."
  type        = string
}

variable "api_shape" {
  description = "OCI shape for the API host. Benchmark before changing."
  type        = string
}

variable "worker_shape" {
  description = "OCI shape for the private worker host. Benchmark before changing."
  type        = string
}

variable "worker_ocpus" {
  description = "OCPUs for flexible worker shapes."
  type        = number
  default     = 2
}

variable "worker_memory_gbs" {
  description = "Memory in GiB for flexible worker shapes."
  type        = number
  default     = 12
}

variable "api_ingress_cidrs" {
  description = "CIDRs allowed to reach the Genithm API on TCP/8000. Prefer Cloudflare/VPN-controlled ranges."
  type        = list(string)
  default     = []
}

variable "ssh_ingress_cidrs" {
  description = "Administrative CIDRs allowed to reach API-host SSH. Keep empty when using OCI Bastion."
  type        = list(string)
  default     = []
}

variable "vcn_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "api_subnet_cidr" {
  type    = string
  default = "10.42.10.0/24"
}

variable "worker_subnet_cidr" {
  type    = string
  default = "10.42.20.0/24"
}

variable "tags" {
  description = "Freeform tags applied to Genithm OCI resources."
  type        = map(string)
  default = {
    application = "genithm"
    environment = "production"
    managed_by  = "terraform"
  }
}
