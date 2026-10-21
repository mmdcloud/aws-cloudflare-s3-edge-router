terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

locals {
  # Resource naming and tagging
  dashboard_name = coalesce(
    var.dashboard_name,
    "${var.s3_bucket_name}-${var.environment}-edge-router"
  )

  create_sns_topic = var.create_sns_topic && var.notification_sns_topic_arn == null
  sns_topic_arn    = local.create_sns_topic ? aws_sns_topic.alerts[0].arn : var.notification_sns_topic_arn

  common_tags = merge(
    {
      Environment = var.environment
      Role        = "observability"
      ManagedBy   = "terraform"
      Component   = "aws-cloudflare-edge-router"
    },
    var.tags
  )
}

# ------------------------------------------------------------------------------
# 1. AWS SNS Topic for Operational Alerts
# Dispatches high 4xx/5xx error and egress spike notifications to operations team
# ------------------------------------------------------------------------------
resource "aws_sns_topic" "alerts" {
  count = local.create_sns_topic ? 1 : 0

  name              = "${var.s3_bucket_name}-${var.environment}-alerts"
  display_name      = "Media Edge Alerts (${var.environment})"
  kms_master_key_id = "alias/aws/sns"

  tags = local.common_tags
}

# SNS Topic Policy granting CloudWatch Alarms permission to publish alerts
resource "aws_sns_topic_policy" "alerts" {
  count = local.create_sns_topic ? 1 : 0
  arn   = aws_sns_topic.alerts[0].arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudWatchAlarmsToPublish"
        Effect = "Allow"
        Principal = {
          Service = "cloudwatch.amazonaws.com"
        }
        Action   = "sns:Publish"
        Resource = aws_sns_topic.alerts[0].arn
        Condition = {
          ArnLike = {
            "aws:SourceArn" = "arn:aws:cloudwatch:${var.aws_region}:*:alarm:*"
          }
        }
      }
    ]
  })
}

# Optional Email Subscription for immediate notification delivery
resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email != null && var.alert_email != "" && local.sns_topic_arn != null ? 1 : 0
  topic_arn = local.sns_topic_arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ------------------------------------------------------------------------------
# 2. AWS CloudWatch Dashboard
# Full operational visibility for Edge Streaming Router, R2 Cache, and S3 Origin
# ------------------------------------------------------------------------------
resource "aws_cloudwatch_dashboard" "media_edge_dashboard" {
  dashboard_name = local.dashboard_name

  dashboard_body = jsonencode({
    widgets = [
      # Header & Architecture Overview
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 3
        properties = {
          markdown = <<-EOT
            # 🚀 Edge Media Router & S3 Origin Monitoring
            **Environment:** `${var.environment}` | **Origin Bucket:** `${var.s3_bucket_name}` | **AWS Region:** `${var.aws_region}`
            *Architecture Flow:* `Client Video Player` ➔ `Cloudflare Worker Edge Router` ➔ `Cloudflare R2 Cache Tier` ➔ `AWS S3 Media Origin`
            ---
          EOT
        }
      },

      # Widget: S3 Request Volume
      {
        type   = "metric"
        x      = 0
        y      = 3
        width  = 12
        height = 6
        properties = {
          title   = "S3 Origin Request Volume (Hits from Edge Misses)"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 300
          metrics = [
            [
              "AWS/S3", "AllRequests",
              "BucketName", var.s3_bucket_name,
              "FilterId", "EntireBucket",
              { "stat" : "Sum", "color" : "#1f77b4", "label" : "Total Requests (Origin Calls)" }
            ],
            [
              "AWS/S3", "GetRequests",
              "BucketName", var.s3_bucket_name,
              "FilterId", "EntireBucket",
              { "stat" : "Sum", "color" : "#2ca02c", "label" : "GET / HEAD Requests" }
            ]
          ]
          yAxis = {
            left = {
              label     = "Request Count"
              showUnits = false
            }
          }
        }
      },

      # Widget: S3 Error Rates (4xx & 5xx)
      {
        type   = "metric"
        x      = 12
        y      = 3
        width  = 12
        height = 6
        properties = {
          title   = "S3 Origin Error Counts (4xx Client / 5xx Server)"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 300
          metrics = [
            [
              "AWS/S3", "4xxErrors",
              "BucketName", var.s3_bucket_name,
              "FilterId", "EntireBucket",
              { "stat" : "Sum", "color" : "#ff7f0e", "label" : "4xx Errors (Missing / Auth)" }
            ],
            [
              "AWS/S3", "5xxErrors",
              "BucketName", var.s3_bucket_name,
              "FilterId", "EntireBucket",
              { "stat" : "Sum", "color" : "#d62728", "label" : "5xx Errors (S3 / Throttle)" }
            ]
          ]
          yAxis = {
            left = {
              label     = "Error Count"
              showUnits = false
            }
          }
        }
      },

      # Widget: Data Egress (Bandwidth to Cloudflare Edge)
      {
        type   = "metric"
        x      = 0
        y      = 9
        width  = 12
        height = 6
        properties = {
          title   = "S3 Origin Egress Bandwidth (BytesDownloaded)"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 300
          metrics = [
            [
              "AWS/S3", "BytesDownloaded",
              "BucketName", var.s3_bucket_name,
              "FilterId", "EntireBucket",
              { "id" : "mBytesDown", "visible" : false, "stat" : "Sum" }
            ],
            [
              {
                "expression" : "mBytesDown / 1073741824",
                "label" : "Egress Volume (Gigabytes / 5m)",
                "id" : "eGigaBytes",
                "color" : "#9467bd"
              }
            ],
            [
              {
                "expression" : "(mBytesDown * 8) / (300 * 1000000)",
                "label" : "Average Egress Throughput (Mbps)",
                "id" : "eThroughputMbps",
                "color" : "#8c564b"
              }
            ]
          ]
          yAxis = {
            left = {
              label     = "GB / Mbps"
              showUnits = false
            }
          }
        }
      },

      # Widget: Latency Profile (FirstByteLatency & TotalRequestLatency)
      {
        type   = "metric"
        x      = 12
        y      = 9
        width  = 12
        height = 6
        properties = {
          title   = "Origin Latency Profile (Time to First Byte & Total)"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 300
          metrics = [
            [
              "AWS/S3", "FirstByteLatency",
              "BucketName", var.s3_bucket_name,
              "FilterId", "EntireBucket",
              { "stat" : "Average", "color" : "#17becf", "label" : "TTFB Avg (ms)" }
            ],
            [
              "AWS/S3", "FirstByteLatency",
              "BucketName", var.s3_bucket_name,
              "FilterId", "EntireBucket",
              { "stat" : "p95", "color" : "#bcbd22", "label" : "TTFB p95 (ms)" }
            ],
            [
              "AWS/S3", "TotalRequestLatency",
              "BucketName", var.s3_bucket_name,
              "FilterId", "EntireBucket",
              { "stat" : "Average", "color" : "#7f7f7f", "label" : "Total Latency Avg (ms)" }
            ],
            [
              "AWS/S3", "TotalRequestLatency",
              "BucketName", var.s3_bucket_name,
              "FilterId", "EntireBucket",
              { "stat" : "p95", "color" : "#e377c2", "label" : "Total Latency p95 (ms)" }
            ]
          ]
          yAxis = {
            left = {
              label     = "Latency (Milliseconds)"
              showUnits = false
            }
          }
        }
      },

      # Widget: Error Rates (% Single Value Stat)
      {
        type   = "metric"
        x      = 0
        y      = 15
        width  = 12
        height = 5
        properties = {
          title  = "Origin Error Rate Percentages"
          view   = "singleValue"
          region = var.aws_region
          period = 300
          metrics = [
            [
              "AWS/S3", "AllRequests",
              "BucketName", var.s3_bucket_name,
              "FilterId", "EntireBucket",
              { "id" : "mTotal", "visible" : false, "stat" : "Sum" }
            ],
            [
              "AWS/S3", "4xxErrors",
              "BucketName", var.s3_bucket_name,
              "FilterId", "EntireBucket",
              { "id" : "m4xx", "visible" : false, "stat" : "Sum" }
            ],
            [
              "AWS/S3", "5xxErrors",
              "BucketName", var.s3_bucket_name,
              "FilterId", "EntireBucket",
              { "id" : "m5xx", "visible" : false, "stat" : "Sum" }
            ],
            [
              {
                "expression" : "IF(mTotal > 0, (m4xx / mTotal) * 100, 0)",
                "label" : "4xx Error %",
                "id" : "eRate4xx",
                "color" : "#ff7f0e"
              }
            ],
            [
              {
                "expression" : "IF(mTotal > 0, (m5xx / mTotal) * 100, 0)",
                "label" : "5xx Error %",
                "id" : "eRate5xx",
                "color" : "#d62728"
              }
            ]
          ]
        }
      },

      # Widget: Storage Footprint & Object Count
      {
        type   = "metric"
        x      = 12
        y      = 15
        width  = 12
        height = 5
        properties = {
          title   = "Origin Storage Footprint & Total Media Objects"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 86400 # Daily S3 storage metric
          metrics = [
            [
              "AWS/S3", "BucketSizeBytes",
              "StorageType", "StandardStorage",
              "BucketName", var.s3_bucket_name,
              { "id" : "mStandardBytes", "visible" : false, "stat" : "Average" }
            ],
            [
              {
                "expression" : "mStandardBytes / 1073741824",
                "label" : "Standard Storage (GB)",
                "id" : "eStandardGB",
                "color" : "#1f77b4"
              }
            ],
            [
              "AWS/S3", "NumberOfObjects",
              "StorageType", "AllStorageTypes",
              "BucketName", var.s3_bucket_name,
              {
                "stat" : "Average",
                "color" : "#2ca02c",
                "label" : "Total Object Count",
                "yAxis" : "right"
              }
            ]
          ]
          yAxis = {
            left = {
              label     = "Storage Size (GB)"
              showUnits = false
            }
            right = {
              label     = "Total Objects"
              showUnits = false
            }
          }
        }
      }
    ]
  })
}
