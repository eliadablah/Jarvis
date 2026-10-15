# One-time setup that everything else depends on: the S3 bucket that holds
# Terraform's state, and the GitHub -> AWS trust (OIDC) that lets GitHub
# Actions deploy without stored AWS keys.
#
# This folder keeps its own state locally (it creates the bucket the other
# folders store their state in), so it's applied by hand, not from CI.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
