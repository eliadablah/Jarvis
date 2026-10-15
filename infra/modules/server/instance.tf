# The Lightsail server itself.

locals {
  boot_script = templatefile("${path.module}/templates/user_data.sh.tftpl", {
    tailscale_auth_key = tailscale_tailnet_key.server.key
    hostname           = var.name
    tailscale_tags     = join(",", var.tailscale_tags)
  })

  # Lightsail only reliably runs the first line of a launch script, so the
  # real script travels base64-encoded inside a single sh-compatible line.
  # The unpacked copy holds the one-time Tailscale key: root-only, and
  # deleted after it runs (the boot log keeps the record).
  launch_script = join(" ", [
    "echo ${base64encode(local.boot_script)} | base64 -d > /root/jarvis-boot.sh &&",
    "chmod 700 /root/jarvis-boot.sh &&",
    "bash /root/jarvis-boot.sh;",
    "rm -f /root/jarvis-boot.sh",
  ])
}

resource "aws_lightsail_instance" "server" {
  name              = var.name
  availability_zone = var.availability_zone
  blueprint_id      = var.blueprint_id
  bundle_id         = var.bundle_id
  ip_address_type   = "dualstack"

  user_data = local.launch_script

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
