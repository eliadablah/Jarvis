# The prod server, built from the shared server module.

module "server" {
  source = "../../modules/server"

  name              = "jarvis-prod"
  availability_zone = var.availability_zone
  bundle_id         = "small_3_0"
  tailscale_tags    = ["tag:prod"]
}
