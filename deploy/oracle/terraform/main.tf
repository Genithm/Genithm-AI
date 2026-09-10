locals {
  api_user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
    role               = "api"
    ssh_authorized_key = var.ssh_authorized_key
  }))
  worker_user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
    role               = "workers"
    ssh_authorized_key = var.ssh_authorized_key
  }))
}

resource "oci_core_vcn" "genithm" {
  compartment_id = var.compartment_ocid
  cidr_block     = var.vcn_cidr
  display_name   = "genithm-v1"
  dns_label      = "genithmv1"
  freeform_tags  = var.tags
}

resource "oci_core_internet_gateway" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.genithm.id
  display_name   = "genithm-v1-internet"
  enabled        = true
  freeform_tags  = var.tags
}

resource "oci_core_nat_gateway" "workers" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.genithm.id
  display_name   = "genithm-v1-workers-nat"
  freeform_tags  = var.tags
}

resource "oci_core_route_table" "api" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.genithm.id
  display_name   = "genithm-v1-api-routes"
  freeform_tags  = var.tags

  route_rules {
    network_entity_id = oci_core_internet_gateway.public.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}

resource "oci_core_route_table" "workers" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.genithm.id
  display_name   = "genithm-v1-worker-routes"
  freeform_tags  = var.tags

  route_rules {
    network_entity_id = oci_core_nat_gateway.workers.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}

resource "oci_core_subnet" "api" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.genithm.id
  cidr_block                 = var.api_subnet_cidr
  display_name               = "genithm-v1-api-public"
  dns_label                  = "api"
  prohibit_public_ip_on_vnic = false
  route_table_id             = oci_core_route_table.api.id
  freeform_tags              = var.tags
}

resource "oci_core_subnet" "workers" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.genithm.id
  cidr_block                 = var.worker_subnet_cidr
  display_name               = "genithm-v1-workers-private"
  dns_label                  = "workers"
  prohibit_public_ip_on_vnic = true
  route_table_id             = oci_core_route_table.workers.id
  freeform_tags              = var.tags
}

resource "oci_core_network_security_group" "api" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.genithm.id
  display_name   = "genithm-v1-api-nsg"
  freeform_tags  = var.tags
}

resource "oci_core_network_security_group" "workers" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.genithm.id
  display_name   = "genithm-v1-workers-nsg"
  freeform_tags  = var.tags
}

resource "oci_core_network_security_group_security_rule" "api_ssh" {
  for_each                  = toset(var.ssh_ingress_cidrs)
  network_security_group_id = oci_core_network_security_group.api.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = each.value
  source_type               = "CIDR_BLOCK"

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

resource "oci_core_network_security_group_security_rule" "api_egress" {
  network_security_group_id = oci_core_network_security_group.api.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
}

resource "oci_core_network_security_group_security_rule" "worker_egress" {
  network_security_group_id = oci_core_network_security_group.workers.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
}

resource "oci_core_instance" "api" {
  availability_domain = var.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = "genithm-v1-api"
  shape               = var.api_shape
  freeform_tags       = var.tags

  create_vnic_details {
    subnet_id        = oci_core_subnet.api.id
    assign_public_ip = true
    nsg_ids          = [oci_core_network_security_group.api.id]
    hostname_label   = "api"
  }

  source_details {
    source_type = "image"
    source_id   = var.image_ocid
  }

  metadata = {
    user_data = local.api_user_data
  }
}

resource "oci_core_instance" "workers" {
  availability_domain = var.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = "genithm-v1-workers"
  shape               = var.worker_shape
  freeform_tags       = var.tags

  create_vnic_details {
    subnet_id        = oci_core_subnet.workers.id
    assign_public_ip = false
    nsg_ids          = [oci_core_network_security_group.workers.id]
    hostname_label   = "workers"
  }

  source_details {
    source_type = "image"
    source_id   = var.image_ocid
  }

  dynamic "shape_config" {
    for_each = can(regex("Flex$", var.worker_shape)) ? [1] : []
    content {
      ocpus         = var.worker_ocpus
      memory_in_gbs = var.worker_memory_gbs
    }
  }

  metadata = {
    user_data = local.worker_user_data
  }
}
