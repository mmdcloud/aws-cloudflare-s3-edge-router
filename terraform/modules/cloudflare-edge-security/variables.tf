variable "cloudflare_zone_id" {
  description = "The Cloudflare DNS Zone ID"
  type        = string
}

variable "enable_tiered_cache" {
  description = "Whether to enable Cloudflare Argo Tiered Cache"
  type        = bool
  default     = true
}

variable "enable_waf_rate_limiting" {
  description = "Whether to deploy edge rate limiting rules for manifests and video segments"
  type        = bool
  default     = true
}

variable "manifest_rate_limit_requests" {
  description = "Maximum manifest requests (.m3u8, .mpd) allowed per period per IP"
  type        = number
  default     = 60
}

variable "manifest_rate_limit_period" {
  description = "Period in seconds for manifest rate limiting counter window"
  type        = number
  default     = 60
}

variable "segment_rate_limit_requests" {
  description = "Maximum media segment requests (.ts, .m4s) allowed per period per IP"
  type        = number
  default     = 1200
}

variable "segment_rate_limit_period" {
  description = "Period in seconds for segment rate limiting counter window"
  type        = number
  default     = 60
}

variable "blocked_countries" {
  description = "List of ISO-3166-1 alpha-2 country codes to block at the edge (e.g. ['KP', 'SY'])"
  type        = list(string)
  default     = []
}

variable "enable_geo_blocking" {
  description = "Enable edge WAF geo-blocking for blocked_countries list"
  type        = bool
  default     = false
}

