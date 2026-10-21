## -----------------------------------------------------------------------------
## Cloudflare Logpush Job Integration for Edge Media Router Telemetry
##
## Cloudflare Logpush delivers real-time HTTP requests and Edge Worker execution
## logs (workers_trace_events) directly to an AWS S3 Bucket or Datadog intake.
##
## -----------------------------------------------------------------------------
## Destination 1: AWS S3 Bucket Destination
## Format:
##   s3://<destination-bucket>/<log-prefix>?region=<aws-region>&sse-algorithm=AES256
##
## Required AWS S3 Bucket Policy for Cloudflare Logpush:
## Cloudflare writes logs using AWS Account ID: 395989260170
## {
##   "Version": "2012-10-17",
##   "Statement": [
##     {
##       "Sid": "AllowCloudflareLogpushWrites",
##       "Effect": "Allow",
##       "Principal": {
##         "AWS": "arn:aws:iam::395989260170:root"
##       },
##       "Action": "s3:PutObject",
##       "Resource": "arn:aws:s3:::<destination-bucket>/<log-prefix>/*"
##     }
##   ]
## }
##
## Ownership Challenge Verification:
## Cloudflare requires creating a challenge file to verify bucket ownership:
##   curl -s -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/logpush/ownership" \
##        -H "X-Auth-Email: <EMAIL>" -H "X-Auth-Key: <API_KEY>" \
##        --data '{"destination_conf":"s3://<destination-bucket>/<log-prefix>?region=<aws-region>"}'
## -----------------------------------------------------------------------------
## Destination 2: Datadog HTTP Log Intake Destination
## Format:
##   datadog://http-intake.logs.datadoghq.com/api/v2/logs?dd-api-key=<DATADOG_API_KEY>&ddsource=cloudflare&service=edge-media-router
## -----------------------------------------------------------------------------

# If the Cloudflare provider is configured in the root module, the following
# production-grade resource can be enabled to manage the Logpush job:
#
# resource "cloudflare_logpush_job" "edge_router_telemetry" {
#   count       = var.enable_cloudflare_logpush && var.cloudflare_account_id != "" && var.logpush_destination != "" ? 1 : 0
#   account_id  = var.cloudflare_account_id
#   name        = "${var.s3_bucket_name}-worker-logpush-${var.environment}"
#   enabled     = true
#   dataset     = var.logpush_dataset # "workers_trace_events" or "http_requests"
#   destination_conf = var.logpush_destination
#
#   # Structured log fields capturing edge latency, cache status, and ray IDs
#   logstream = true
#
#   output_options {
#     field_names = [
#       "ClientRequestHTTPHost",
#       "ClientRequestHTTPMethod",
#       "ClientRequestPath",
#       "ClientRequestURI",
#       "ClientIP",
#       "ClientCountry",
#       "ClientASN",
#       "EdgeStartTimestamp",
#       "EdgeEndTimestamp",
#       "EdgeResponseStatus",
#       "EdgeResponseBytes",
#       "OriginResponseStatus",
#       "OriginResponseTime",
#       "RayID"
#     ]
#     output_type = "ndjson"
#     timestamp_format = "rfc3339"
#   }
# }

output "cloudflare_logpush_s3_policy_guidance" {
  description = "Guidance and AWS IAM policy JSON required if configuring Cloudflare Logpush to write directly to S3."
  value = {
    cloudflare_aws_account_id = "395989260170"
    sample_destination_conf   = "s3://${var.s3_bucket_name}/edge-logs?region=${var.aws_region}&sse-algorithm=AES256"
    datadog_destination_conf  = "datadog://http-intake.logs.datadoghq.com/api/v2/logs?dd-api-key=<DD_API_KEY>&ddsource=cloudflare&service=edge-media-router"
    verification_steps        = "Request ownership challenge via Cloudflare API, read verification token written to S3, and submit validation request."
  }
}
