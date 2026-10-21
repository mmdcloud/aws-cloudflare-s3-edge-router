## -----------------------------------------------------------------------------
## Root Variables
## High-Throughput Edge Media Streaming Router Infrastructure
## -----------------------------------------------------------------------------

variable "region" {
  description = "The primary AWS Region for origin media storage and monitoring."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name (e.g. prod, staging, dev)."
  type        = string
  default     = "prod"
}

# -----------------------------------------------------------------------------
# AWS S3 Origin Settings
# -----------------------------------------------------------------------------

variable "bucket_name_prefix" {
  description = "Prefix for S3 media origin bucket name."
  type        = string
  default     = "media-origin"
}

variable "bucket_name" {
  description = "Explicit S3 bucket name. If null, generated automatically."
  type        = string
  default     = null
}

variable "force_destroy" {
  description = "Whether to force destroy the S3 origin bucket if objects exist."
  type        = bool
  default     = false
}

variable "s3_versioning_enabled" {
  description = "Whether S3 origin bucket versioning is enabled."
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# Cloudflare Credentials & Domain Configuration
# -----------------------------------------------------------------------------

variable "cloudflare_api_token" {
  description = "Cloudflare API Token with Workers, R2, KV, and Zone permissions."
  type        = string
  sensitive   = true
  default     = ""
}

variable "cloudflare_account_id" {
  description = "Cloudflare Account ID."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare DNS Zone ID for worker routes."
  type        = string
}

variable "r2_bucket_name" {
  description = "Cloudflare R2 bucket name for hot media edge cache tier."
  type        = string
  default     = "media-cache-edge"
}

variable "r2_location" {
  description = "Geographic location hint for the R2 bucket (e.g., wnam, enam, weur, apac)."
  type        = string
  default     = "wnam"
}

variable "worker_name" {
  description = "Cloudflare Worker service name."
  type        = string
  default     = "edge-media-router"
}

variable "worker_script_path" {
  description = "Relative or absolute path to the compiled JavaScript bundle for the worker."
  type        = string
  default     = "../dist/index.js"
}

variable "route_patterns" {
  description = "List of route patterns to attach to the Cloudflare Worker."
  type        = list(string)
  default     = []
}

variable "custom_domain" {
  description = "Optional custom domain hostname for the worker."
  type        = string
  default     = ""
}

variable "enable_custom_domain" {
  description = "Whether to attach a custom domain to the worker."
  type        = bool
  default     = false
}

variable "auth_secret_key" {
  description = "Secret key used for HMAC-SHA256 streaming token validation."
  type        = string
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Edge Security, WAF, & Tiered Cache
# -----------------------------------------------------------------------------

variable "enable_tiered_cache" {
  description = "Whether to enable Cloudflare Argo Tiered Cache."
  type        = bool
  default     = true
}

variable "enable_waf_rate_limiting" {
  description = "Whether to deploy edge rate limiting rules for manifests and video segments."
  type        = bool
  default     = true
}

variable "manifest_rate_limit_requests" {
  description = "Maximum manifest requests (.m3u8, .mpd) allowed per period per IP."
  type        = number
  default     = 60
}

variable "manifest_rate_limit_period" {
  description = "Period in seconds for manifest rate limiting counter window."
  type        = number
  default     = 60
}

variable "segment_rate_limit_requests" {
  description = "Maximum media segment requests (.ts, .m4s) allowed per period per IP."
  type        = number
  default     = 1200
}

variable "segment_rate_limit_period" {
  description = "Period in seconds for segment rate limiting counter window."
  type        = number
  default     = 60
}

variable "enable_geo_blocking" {
  description = "Enable edge WAF geo-blocking for blocked_countries list."
  type        = bool
  default     = false
}

variable "blocked_countries" {
  description = "List of ISO-3166-1 alpha-2 country codes to block at edge (e.g. ['KP', 'SY'])."
  type        = list(string)
  default     = []
}

# -----------------------------------------------------------------------------
# Edge Security, WAF, & Tiered Cache
# -----------------------------------------------------------------------------

variable "enable_tiered_cache" {
  description = "Whether to enable Cloudflare Argo Tiered Cache."
  type        = bool
  default     = true
}

variable "enable_waf_rate_limiting" {
  description = "Whether to deploy edge rate limiting rules for manifests and video segments."
  type        = bool
  default     = true
}

variable "manifest_rate_limit_requests" {
  description = "Maximum manifest requests (.m3u8, .mpd) allowed per period per IP."
  type        = number
  default     = 60
}

variable "manifest_rate_limit_period" {
  description = "Period in seconds for manifest rate limiting counter window."
  type        = number
  default     = 60
}

variable "segment_rate_limit_requests" {
  description = "Maximum media segment requests (.ts, .m4s) allowed per period per IP."
  type        = number
  default     = 1200
}

variable "segment_rate_limit_period" {
  description = "Period in seconds for segment rate limiting counter window."
  type        = number
  default     = 60
}

variable "enable_geo_blocking" {
  description = "Enable edge WAF geo-blocking for blocked_countries list."
  type        = bool
  default     = false
}

variable "blocked_countries" {
  description = "List of ISO-3166-1 alpha-2 country codes to block at edge (e.g. ['KP', 'SY'])."
  type        = list(string)
  default     = []
}

# -----------------------------------------------------------------------------
# Observability & Alerts
# -----------------------------------------------------------------------------

variable "alert_email" {
  description = "Email address for CloudWatch alarm notifications via SNS."
  type        = string
  default     = null
}

variable "enable_cloudflare_logpush" {
  description = "Whether to configure Cloudflare Logpush for worker request logs."
  type        = bool
  default     = false
}

