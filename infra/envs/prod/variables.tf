# Prod settings. Defaults are my real setup; nothing here is secret.

variable "aws_region" {
  description = "Region the prod server runs in."
  type        = string
  default     = "us-east-1"
}

variable "availability_zone" {
  description = "Lightsail availability zone for the server."
  type        = string
  default     = "us-east-1a"
}
