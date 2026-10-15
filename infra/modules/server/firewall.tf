# Lightsail firewall. This resource REPLACES all of Lightsail's default rules
# (which open SSH 22 and HTTP 80 to the world).
#
# Lightsail requires at least one rule, so the only one is Tailscale's
# WireGuard port. It answers only devices holding keys for my tailnet and is
# silent to everyone else. It lets my devices connect directly instead of
# through Tailscale's relays. No TCP port (SSH, HTTP, HTTPS) is open.

resource "aws_lightsail_instance_public_ports" "server" {
  instance_name = aws_lightsail_instance.server.name

  port_info {
    protocol   = "udp"
    from_port  = 41641
    to_port    = 41641
    cidrs      = ["0.0.0.0/0"]
    ipv6_cidrs = ["::/0"]
  }
}
