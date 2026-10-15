# Inputs for the bootstrap stack. The defaults are my real setup; nothing
# here is secret.

variable "aws_region" {
  description = "AWS region for the Terraform state bucket. Servers pick their own region."
  type        = string
  default     = "us-east-2"
}

variable "github_repo" {
  description = "GitHub repo allowed to deploy, as owner/name (case must match GitHub)."
  type        = string
  default     = "eliadablah/Jarvis"
}

variable "production_environment" {
  description = "GitHub Actions environment whose jobs may change AWS."
  type        = string
  default     = "production"
}
