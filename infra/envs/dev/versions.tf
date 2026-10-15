# Dev environment: the jarvis-dev test server.
#
# Same blueprint as prod (modules/server), smaller and cheaper. I build it to
# test a change, then destroy it, so it only costs money while I'm testing.
# State lives next to prod's in the bootstrap S3 bucket, under its own key.

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
    key          = "envs/dev/terraform.tfstate"
    region       = "us-east-2"
    encrypt      = true
    use_lockfile = true
  }
}
