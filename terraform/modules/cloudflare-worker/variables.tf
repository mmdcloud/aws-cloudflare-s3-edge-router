variable "cloudflare_account_id" {
  description = "The Cloudflare Account ID"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "The Cloudflare DNS Zone ID"
  type        = string
}

variable "worker_name" {
  description = "The name of the Cloudflare Worker"
  type        = string
  default     = "edge-media-router"
}

variable "worker_script_path" {
  description = "The local path to the compiled worker JavaScript bundle"
  type        = string
}

variable "route_patterns" {
  description = "List of route patterns for the Worker (e.g. ['media.example.com/*'])"
  type        = list(string)
  default     = []
}

variable "custom_domain" {
  description = "Optional custom hostname for Cloudflare Workers Custom Domain (e.g. media.example.com)"
  type        = string
  default     = ""
}

variable "enable_custom_domain" {
  description = "Whether to attach the worker as a Custom Domain"
  type        = bool
  default     = false
}

variable "r2_bucket_name" {
  description = "The name of the Cloudflare R2 bucket for zero-egress hot cache"
  type        = string
}

variable "aws_region" {
  description = "The AWS Region of the primary S3 bucket"
  type        = string
}

variable "s3_bucket_name" {
  description = "The AWS S3 bucket name of the primary origin"
  type        = string
}

variable "aws_access_key_id" {
  description = "AWS Access Key ID for Worker SigV4 S3 signing"
  type        = string
  sensitive   = true
}

variable "aws_secret_access_key" {
  description = "AWS Secret Access Key for Worker SigV4 S3 signing"
  type        = string
  sensitive   = true
}

variable "auth_secret_key" {
  description = "HMAC-SHA256 secret key for signing and validating streaming tokens"
  type        = string
  sensitive   = true
}

variable "cache_manifest_ttl" {
  description = "Micro-TTL in seconds for manifests (.m3u8, .mpd)"
  type        = number
  default     = 2
}

variable "cache_segment_ttl" {
  description = "Edge TTL in seconds for video segments (.ts, .m4s)"
  type        = number
  default     = 31536000 # 1 year
}

variable "async_hydration_enabled" {
  description = "Whether to asynchronously replicate hot S3 media chunks to R2 via waitUntil"
  type        = bool
  default     = true
}

variable "failover_enabled" {
  description = "Whether to failover to S3 if R2 object returns 404"
  type        = bool
  default     = true
}

variable "environment" {
  description = "Environment name (production, staging, dev)"
  type        = string
  default     = "production"
}

variable "allowed_origins" {
  description = "Comma-separated list of allowed CORS origins"
  type        = string
  default     = "*"
}

variable "enable_geo_steering" {
  description = "Enable Geo / Bandwidth dynamic manifest adaptation"
  type        = bool
  default     = true
}

