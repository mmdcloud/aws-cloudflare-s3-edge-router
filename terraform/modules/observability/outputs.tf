## -----------------------------------------------------------------------------
## Outputs for Observability Module
## -----------------------------------------------------------------------------

output "dashboard_name" {
  description = "The name of the provisioned AWS CloudWatch Dashboard."
  value       = aws_cloudwatch_dashboard.media_edge_dashboard.dashboard_name
}

output "dashboard_arn" {
  description = "The ARN of the provisioned AWS CloudWatch Dashboard."
  value       = aws_cloudwatch_dashboard.media_edge_dashboard.dashboard_arn
}

output "sns_topic_arn" {
  description = "The ARN of the SNS Topic utilized for operational alerts."
  value       = local.sns_topic_arn
}

output "sns_topic_name" {
  description = "The name of the provisioned SNS Topic (if created by this module)."
  value       = local.create_sns_topic ? aws_sns_topic.alerts[0].name : null
}

output "alert_email_configured" {
  description = "Whether an email address was configured for SNS operational alerts."
  value       = var.alert_email != null && var.alert_email != ""
}
