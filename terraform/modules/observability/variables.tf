## -----------------------------------------------------------------------------
## Variables for Observability Module
## CloudWatch Dashboard, Operational SNS Alerts, & Edge Logpush Integration
## -----------------------------------------------------------------------------

variable "aws_region" {
  description = "The AWS Region where the S3 origin and CloudWatch resources reside."
  type        = string
  default     = "us-east-1"
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

variable "s3_bucket_name" {
  description = "The name of the AWS S3 origin bucket to monitor."
  type        = string
}

variable "dashboard_name" {
  description = "Optional custom name for the CloudWatch Dashboard. If null, generated from bucket name and environment."
  type        = string
  default     = null
}

variable "alert_email" {
  description = "Optional email address to receive immediate SNS email notifications for alarms."
  type        = string
  default     = null
}

variable "notification_sns_topic_arn" {
  description = "Optional existing SNS topic ARN for alert routing. If provided, overrides topic creation."
  type        = string
  default     = null
}

variable "create_sns_topic" {
  description = "Whether to create a new dedicated SNS topic for alerts when notification_sns_topic_arn is null."
  type        = bool
  default     = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare Account ID for configuring edge worker Logpush jobs."
  type        = string
  default     = ""
}

variable "cloudflare_zone_id" {
  description = "Cloudflare Zone ID for edge streaming routing."
  type        = string
  default     = ""
}

variable "enable_cloudflare_logpush" {
  description = "Whether to provision Cloudflare Logpush job for streaming worker execution logs to S3 or Datadog."
  type        = bool
  default     = false
}

variable "logpush_destination" {
  description = "Destination URL for Cloudflare Logpush. Supports S3 (e.g., 's3://<bucket>/edge-logs?region=us-east-1') or Datadog ('datadog://...')."
  type        = string
  default     = ""
}

variable "logpush_dataset" {
  description = "Cloudflare Logpush dataset. Options: 'workers_trace_events' (detailed worker telemetry) or 'http_requests'."
  type        = string
  default     = "workers_trace_events"
}

variable "tags" {
  description = "Custom resource tags to apply across observability resources."
  type        = map(string)
  default     = {}
}
