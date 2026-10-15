# The dev server, built from the same module as prod.
# Differences from prod: smaller plan, its own tag, and no snapshots
# (dev is temporary, so there's nothing worth backing up).

module "server" {
  source = "../../modules/server"

  name              = "jarvis-dev"
  availability_zone = var.availability_zone
  bundle_id         = "micro_3_0" # 1 GB RAM, $7/month, billed hourly
  tailscale_tags    = ["tag:dev"]
  auto_snapshots    = false
}
