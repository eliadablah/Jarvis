# Connections for dev.
#
# Tailscale credentials come from environment variables, never from files:
#   TAILSCALE_OAUTH_CLIENT_ID      (not secret)
#   TAILSCALE_OAUTH_CLIENT_SECRET  (secret: password manager / GitHub secret)

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "jarvis"
      ManagedBy   = "terraform"
      Environment = "dev"
    }
  }
}

provider "tailscale" {
  # "-" means the tailnet the OAuth client belongs to.
  tailnet = "-"
}
