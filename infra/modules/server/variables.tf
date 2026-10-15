# Inputs for one Jarvis server.

variable "name" {
  description = "Server name in Lightsail and its hostname on the tailnet."
  type        = string
}

variable "availability_zone" {
  description = "Lightsail availability zone, e.g. us-east-2a."
  type        = string
}

variable "bundle_id" {
  description = "Lightsail plan. small_3_0 = 2 GB RAM, 60 GB disk, $12/month."
  type        = string
  default     = "small_3_0"
}

variable "blueprint_id" {
  description = "Operating system image."
  type        = string
  default     = "ubuntu_24_04"
}

variable "tailscale_tags" {
  description = "Tailscale tags the server joins with. Must exist in the tailnet policy."
  type        = list(string)
}

variable "auto_snapshots" {
  description = "Take a daily snapshot (Lightsail keeps the last 7)."
  type        = bool
  default     = true
}

variable "snapshot_time" {
  description = "Daily snapshot time in UTC, HH:00."
  type        = string
  default     = "08:00"
}
