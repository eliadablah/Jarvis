# Prod server details.

output "server_name" {
  description = "Lightsail name and Tailscale hostname."
  value       = module.server.name
}

output "public_ipv4" {
  description = "Public IPv4 with every TCP port closed. Use Tailscale to connect."
  value       = module.server.public_ipv4
}
