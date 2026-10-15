# What callers need to know about the server.

output "name" {
  description = "Lightsail name, also the Tailscale hostname."
  value       = aws_lightsail_instance.server.name
}

output "availability_zone" {
  description = "Where the server runs."
  value       = aws_lightsail_instance.server.availability_zone
}

output "public_ipv4" {
  description = "Public IPv4. Every port on it is closed; reach the server through Tailscale."
  value       = aws_lightsail_instance.server.public_ip_address
}
