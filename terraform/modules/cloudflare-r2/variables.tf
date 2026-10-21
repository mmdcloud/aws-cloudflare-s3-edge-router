variable "cloudflare_account_id" {
  description = "The Cloudflare Account ID where the R2 bucket will be created"
  type        = string
}

variable "bucket_name" {
  description = "The name of the Cloudflare R2 bucket for hot media edge cache"
  type        = string
}

variable "location" {
  description = "The geographic location hint for the R2 bucket (e.g. wnam, enam, weur, eeur, apac, oc)"
  type        = string
  default     = "wnam"
}

variable "cors_allowed_origins" {
  description = "List of allowed origins for R2 CORS"
  type        = list(string)
  default     = ["*"]
}

variable "cors_max_age_seconds" {
  description = "Max age in seconds for CORS preflight caching"
  type        = number
  default     = 86400
}

