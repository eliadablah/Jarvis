# Inputs for the bootstrap stack. The defaults are my real setup; nothing
# here is secret.

variable "aws_region" {
  description = "AWS region for the Terraform state bucket. Servers pick their own region."
  type        = string
  default     = "us-east-2"
}

variable "github_oidc_subject_prefix" {
  description = <<-EOT
    Start of the identity ("sub" claim) GitHub Actions sends for my repo.
    The repo uses GitHub's immutable subject format, which includes the
    owner and repo IDs so a renamed or re-created repo can't impersonate it.
    Check with: gh api repos/eliadablah/Jarvis/actions/oidc/customization/sub
  EOT
  type        = string
  default     = "repo:eliadablah@232940632/Jarvis@1421100534"
}

variable "dns_zone_name" {
  description = "Route 53 hosted zone that holds the Jarvis names."
  type        = string
  default     = "eliadablah.com"
}

variable "jarvis_hostnames" {
  description = "The only DNS names the CI robot may change (plus their _acme-challenge records)."
  type        = list(string)
  default     = ["dev-jarvis.eliadablah.com", "jarvis.eliadablah.com"]
}

variable "deploy_environments" {
  description = "GitHub Actions environments whose jobs may update DNS and certificates."
  type        = list(string)
  default     = ["dev", "production"]
}

variable "production_environment" {
  description = "GitHub Actions environment whose jobs may change AWS."
  type        = string
  default     = "production"
}
