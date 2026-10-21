## -----------------------------------------------------------------------------
## Variables for AWS S3 Origin Module
## Production-grade Media Storage for Cloudflare Edge Router Architecture
## -----------------------------------------------------------------------------

variable "bucket_name_prefix" {
  description = "Prefix for the S3 media origin bucket name. Must be lowercase alphanumeric and hyphens."
  type        = string
  default     = "media-origin"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.bucket_name_prefix))
    error_message = "The bucket_name_prefix must contain only lowercase letters, numbers, and hyphens."
  }
}

variable "bucket_name" {
  description = "Optional explicit bucket name. If provided, overrides bucket_name_prefix and environment-based naming."
  type        = string
  default     = null
}

variable "environment" {
  description = "Target deployment environment (e.g., prod, staging, dev)."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "production", "staging", "dev", "test"], var.environment)
    error_message = "Environment must be one of: prod, production, staging, dev, test."
  }
}

variable "force_destroy" {
  description = "Whether to force destroy the bucket even if it contains objects upon deletion. Set to false in production to prevent accidental data loss."
  type        = bool
  default     = false
}

variable "versioning_enabled" {
  description = "Whether S3 bucket versioning is enabled. Protects against unintended overwrites and deletions."
  type        = bool
  default     = true
}

variable "transition_days_standard_ia" {
  description = "Number of days before transitioning non-frequently accessed media objects to S3 Standard-Infrequent Access (Standard-IA)."
  type        = number
  default     = 30

  validation {
    condition     = var.transition_days_standard_ia >= 30
    error_message = "S3 Standard-IA transitions must be at least 30 days."
  }
}

variable "transition_days_glacier" {
  description = "Number of days before transitioning archival media objects to S3 Glacier Flexible."
  type        = number
  default     = 90

  validation {
    condition     = var.transition_days_glacier >= 90
    error_message = "S3 Glacier transitions must be at least 90 days."
  }
}

variable "enable_lifecycle_transitions" {
  description = "Whether to enable lifecycle transition rules for Standard-IA and Glacier Flexible storage tiers."
  type        = bool
  default     = true
}

variable "abort_incomplete_multipart_upload_days" {
  description = "Number of days after which incomplete multipart uploads are automatically aborted and cleaned up to prevent orphaned storage charges."
  type        = number
  default     = 7
}

variable "noncurrent_version_expiration_days" {
  description = "Number of days after which older object versions are permanently deleted when versioning is enabled. Set to 0 to retain indefinitely."
  type        = number
  default     = 365
}

variable "enable_intelligent_tiering" {
  description = "Whether to enable S3 Intelligent-Tiering automatic archive and deep archive access tiers for unpredictable media workloads."
  type        = bool
  default     = true
}

variable "intelligent_tiering_archive_days" {
  description = "Number of days without access before transitioning objects in Intelligent-Tiering to the Archive Access tier (minimum 90 days)."
  type        = number
  default     = 90

  validation {
    condition     = var.intelligent_tiering_archive_days >= 90
    error_message = "Intelligent-Tiering Archive Access days must be at least 90 days."
  }
}

variable "intelligent_tiering_deep_archive_days" {
  description = "Number of days without access before transitioning objects in Intelligent-Tiering to Deep Archive Access tier (minimum 180 days)."
  type        = number
  default     = 180

  validation {
    condition     = var.intelligent_tiering_deep_archive_days >= 180
    error_message = "Intelligent-Tiering Deep Archive Access days must be at least 180 days."
  }
}

variable "cors_allowed_origins" {
  description = "List of allowed origins for Cross-Origin Resource Sharing (CORS). Supports web player streaming domains."
  type        = list(string)
  default     = ["*"]
}

variable "cors_allowed_methods" {
  description = "List of allowed HTTP methods for CORS requests from video clients."
  type        = list(string)
  default     = ["GET", "HEAD"]
}

variable "cors_allowed_headers" {
  description = "List of allowed headers for CORS preflight and Range requests."
  type        = list(string)
  default     = ["Range", "Authorization", "*"]
}

variable "cors_expose_headers" {
  description = "List of response headers exposed to browser streaming clients (essential for HLS/DASH byte-range playback)."
  type        = list(string)
  default     = ["Content-Range", "ETag", "Accept-Ranges", "Content-Length"]
}

variable "cors_max_age_seconds" {
  description = "Time in seconds that browsers can cache CORS preflight OPTIONS responses."
  type        = number
  default     = 86400
}

variable "sse_algorithm" {
  description = "Server-side encryption algorithm to use for the S3 bucket. Supported values: 'AES256' or 'aws:kms'."
  type        = string
  default     = "AES256"

  validation {
    condition     = contains(["AES256", "aws:kms"], var.sse_algorithm)
    error_message = "sse_algorithm must be either 'AES256' or 'aws:kms'."
  }
}

variable "kms_master_key_id" {
  description = "AWS KMS master key ID/ARN used for SSE-KMS encryption. Required when sse_algorithm is 'aws:kms'."
  type        = string
  default     = null
}

variable "iam_user_name" {
  description = "Explicit name for the dedicated least-privilege IAM User. If null, generated automatically."
  type        = string
  default     = null
}

variable "allowed_object_prefixes" {
  description = "List of S3 object key prefixes accessible by the dedicated IAM user. Defaults to ['*'] for entire bucket, or ['media/*', 'vod/*'] to scope."
  type        = list(string)
  default     = ["*"]
}

variable "alarm_actions" {
  description = "List of SNS topic ARNs to notify when CloudWatch alarms breach threshold."
  type        = list(string)
  default     = []
}

variable "ok_actions" {
  description = "List of SNS topic ARNs to notify when CloudWatch alarms recover to OK status."
  type        = list(string)
  default     = []
}

variable "alarm_4xx_threshold" {
  description = "Threshold for 4xx errors count in a 5-minute evaluation period."
  type        = number
  default     = 100
}

variable "alarm_5xx_threshold" {
  description = "Threshold for 5xx errors count in a 5-minute evaluation period."
  type        = number
  default     = 10
}

variable "alarm_egress_threshold_bytes" {
  description = "Threshold for BytesDownloaded (egress) in bytes within a 5-minute period. Defaults to 50 GB (53,687,091,200 bytes)."
  type        = number
  default     = 53687091200 # 50 GB
}

variable "tags" {
  description = "Custom resource tags to apply across all created AWS resources."
  type        = map(string)
  default     = {}
}
