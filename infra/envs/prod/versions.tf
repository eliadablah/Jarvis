# Production environment: the real jarvis-prod server.
#
# State lives in the S3 bucket from infra/bootstrap. The bucket name is passed
# at init time (terraform init -backend-config=backend.hcl) so it isn't
# hardcoded here. Locking uses an S3 lock file, no DynamoDB table needed.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    tailscale = {
      source  = "tailscale/tailscale"
      version = "~> 0.29"
    }
  }

  backend "s3" {
    key          = "envs/prod/terraform.tfstate"
    region       = "us-east-2"
    encrypt      = true
    use_lockfile = true
  }
}
