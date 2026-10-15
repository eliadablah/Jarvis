# Reusable blueprint for one Jarvis server: a Lightsail instance with every
# public port closed, which joins my Tailscale network on first boot.
# Each environment (infra/envs/*) calls this module with its own name and tags.

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
}
