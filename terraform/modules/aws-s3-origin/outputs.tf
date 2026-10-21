## -----------------------------------------------------------------------------
## Outputs for AWS S3 Origin Module
## -----------------------------------------------------------------------------

output "bucket_id" {
  description = "The name/ID of the provisioned S3 origin bucket."
  value       = aws_s3_bucket.origin.id
}

output "bucket_arn" {
  description = "The ARN of the provisioned S3 origin bucket."
  value       = aws_s3_bucket.origin.arn
}

output "bucket_domain_name" {
  description = "The standard bucket domain name (e.g., bucket-name.s3.amazonaws.com)."
  value       = aws_s3_bucket.origin.bucket_domain_name
}

output "bucket_regional_domain_name" {
  description = "The regional bucket domain name formatted for Cloudflare Worker origin routing (e.g., bucket-name.s3.us-east-1.amazonaws.com)."
  value       = aws_s3_bucket.origin.bucket_regional_domain_name
}

output "bucket_region" {
  description = "The AWS Region where the S3 origin bucket resides."
  value       = aws_s3_bucket.origin.region
}

output "iam_user_name" {
  description = "The name of the dedicated least-privilege IAM User for edge router access."
  value       = aws_iam_user.edge_router.name
}

output "iam_user_arn" {
  description = "The ARN of the dedicated least-privilege IAM User."
  value       = aws_iam_user.edge_router.arn
}

output "iam_access_key_id" {
  description = "The AWS Access Key ID for the Cloudflare Worker to sign SigV4 S3 requests."
  value       = aws_iam_access_key.edge_router.id
}

output "iam_secret_access_key" {
  description = "The AWS Secret Access Key for the Cloudflare Worker to sign SigV4 S3 requests."
  value       = aws_iam_access_key.edge_router.secret
  sensitive   = true
}

output "alarm_4xx_arn" {
  description = "The ARN of the CloudWatch alarm monitoring 4xx client errors."
  value       = aws_cloudwatch_metric_alarm.high_4xx_errors.arn
}

output "alarm_5xx_arn" {
  description = "The ARN of the CloudWatch alarm monitoring 5xx server errors."
  value       = aws_cloudwatch_metric_alarm.high_5xx_errors.arn
}

output "alarm_egress_arn" {
  description = "The ARN of the CloudWatch alarm monitoring excessive egress bandwidth."
  value       = aws_cloudwatch_metric_alarm.excessive_data_egress.arn
}
