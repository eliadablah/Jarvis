# AWS connection for the bootstrap resources. Every resource gets the same
# tags so I can find and cost-track everything Jarvis owns.

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "jarvis"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}
