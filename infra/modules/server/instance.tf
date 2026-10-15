# The Lightsail server itself.

resource "aws_lightsail_instance" "server" {
  name              = var.name
  availability_zone = var.availability_zone
  blueprint_id      = var.blueprint_id
  bundle_id         = var.bundle_id
  ip_address_type   = "dualstack"

  user_data = templatefile("${path.module}/templates/user_data.sh.tftpl", {
    tailscale_auth_key = tailscale_tailnet_key.server.key
    hostname           = var.name
    tailscale_tags     = join(",", var.tailscale_tags)
  })

  dynamic "add_on" {
    for_each = var.auto_snapshots ? [1] : []
    content {
      type          = "AutoSnapshot"
      snapshot_time = var.snapshot_time
      status        = "Enabled"
    }
  }

  tags = {
    Name = var.name
  }

  lifecycle {
    # The boot script only runs once. Editing it later must not rebuild a
    # running server; changes after first boot go out through deploys.
    ignore_changes = [user_data]
  }
}
