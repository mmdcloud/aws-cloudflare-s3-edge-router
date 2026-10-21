## -----------------------------------------------------------------------------
## Root Outputs
## -----------------------------------------------------------------------------

# AWS S3 Origin Outputs
output "s3_origin_bucket_id" {
  description = "The ID/Name of the AWS S3 media origin bucket."
  value       = module.aws_s3_origin.bucket_id
}

output "s3_origin_bucket_arn" {
  description = "The ARN of the AWS S3 media origin bucket."
  value       = module.aws_s3_origin.bucket_arn
}

output "s3_origin_regional_domain_name" {
  description = "The regional domain name of the S3 origin bucket."
  value       = module.aws_s3_origin.bucket_regional_domain_name
}

output "s3_edge_iam_user_arn" {
  description = "The ARN of the dedicated IAM User provisioned for Cloudflare Worker S3 access."
  value       = module.aws_s3_origin.iam_user_arn
}

output "s3_edge_iam_access_key_id" {
  description = "The AWS Access Key ID for edge router SigV4 signing."
  value       = module.aws_s3_origin.iam_access_key_id
}

# Cloudflare R2 Outputs
output "cloudflare_r2_bucket_name" {
  description = "The name of the Cloudflare R2 edge cache bucket."
  value       = module.cloudflare_r2.bucket_name
}

# Cloudflare Worker Outputs
output "cloudflare_worker_name" {
  description = "The deployed Cloudflare Worker service name."
  value       = module.cloudflare_worker.worker_name
}

output "cloudflare_worker_routes" {
  description = "Assigned route patterns for the Cloudflare Worker."
  value       = module.cloudflare_worker.worker_routes
}

output "cloudflare_worker_custom_domain" {
  description = "Custom domain attached to the worker (if enabled)."
  value       = module.cloudflare_worker.custom_domain_hostname
}

# Edge Security & WAF Outputs
output "cloudflare_rate_limiting_ruleset_id" {
  description = "ID of the Cloudflare WAF Rate Limiting ruleset."
  value       = module.cloudflare_edge_security.rate_limiting_ruleset_id
}

output "cloudflare_cache_ruleset_id" {
  description = "ID of the Cloudflare Edge Cache ruleset."
  value       = module.cloudflare_edge_security.cache_ruleset_id
}

# Observability Outputs
output "cloudwatch_dashboard_name" {
  description = "The name of the provisioned AWS CloudWatch dashboard."
  value       = module.observability.dashboard_name
}

output "sns_alert_topic_arn" {
  description = "The ARN of the SNS topic receiving operational alarms."
  value       = module.observability.sns_topic_arn
}

# Verification & Test Commands
output "quick_test_instructions" {
  description = "Instructions for generating tokens and verifying playback."
  value       = <<-EOT
    1. Generate a test token:
       node scripts/generate-token.js --path=/stream/live/master.m3u8 --secret=${var.auth_secret_key} --ttl=3600

    2. Test HLS manifest retrieval with token:
       curl -i -H "Accept: application/vnd.apple.mpegurl" "https://${length(var.route_patterns) > 0 ? trim(var.route_patterns[0], "/*") : "media.yourdomain.com"}/stream/live/master.m3u8?token=<TOKEN>"

    3. Test Byte-Range video segment request:
       curl -i -H "Range: bytes=0-1048575" "https://${length(var.route_patterns) > 0 ? trim(var.route_patterns[0], "/*") : "media.yourdomain.com"}/stream/live/segment-001.ts?token=<TOKEN>"
  EOT
}

# Verification & Test Commands
output "quick_test_instructions" {
  description = "Instructions for generating tokens and verifying playback."
  value       = <<-EOT
    1. Generate a test token:
       node scripts/generate-token.js --path=/stream/live/master.m3u8 --secret=${var.auth_secret_key} --ttl=3600

    2. Test HLS manifest retrieval with token:
       curl -i -H "Accept: application/vnd.apple.mpegurl" "https://${length(var.route_patterns) > 0 ? trim(var.route_patterns[0], "/*") : "media.yourdomain.com"}/stream/live/master.m3u8?token=<TOKEN>"

    3. Test Byte-Range video segment request:
       curl -i -H "Range: bytes=0-1048575" "https://${length(var.route_patterns) > 0 ? trim(var.route_patterns[0], "/*") : "media.yourdomain.com"}/stream/live/segment-001.ts?token=<TOKEN>"
  EOT
}

