# One-time Tailscale key the server uses to join my network on first boot.
# Single-use, pre-approved, tagged, and expires after an hour, so a leaked
# copy (it sits in the instance's boot data) is useless.

resource "tailscale_tailnet_key" "server" {
  description   = "${var.name} first boot"
  reusable      = false
  ephemeral     = false
  preauthorized = true
  expiry        = 3600
  tags          = var.tailscale_tags

  # The key is used up on first boot. Don't make a new one on later applies,
  # which would also change the boot script and rebuild the server.
  recreate_if_invalid = "never"
}
