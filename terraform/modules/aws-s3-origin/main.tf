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
  # Consolidated tagging schema
  common_tags = merge(
    {
      Environment = var.environment
      Role        = "media-origin-storage"
      ManagedBy   = "terraform"
      Component   = "aws-cloudflare-edge-router"
    },
    var.tags
  )

  # Computed IAM user name
  iam_user_name = var.iam_user_name != null ? var.iam_user_name : "${aws_s3_bucket.origin.id}-edge-worker"

  # Formatted resource ARN targets for IAM object reads
  allowed_object_arns = [
    for prefix in var.allowed_object_prefixes : (
      prefix == "*" || prefix == "/*"
      ? "${aws_s3_bucket.origin.arn}/*"
      : "${aws_s3_bucket.origin.arn}/${trimprefix(prefix, "/")}${endswith(prefix, "/*") ? "" : endswith(prefix, "/") ? "*" : "/*"}"
    )
  ]
}

# ------------------------------------------------------------------------------
# 1. AWS S3 Media Origin Bucket
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "origin" {
  bucket        = var.bucket_name
  bucket_prefix = var.bucket_name == null ? "${var.bucket_name_prefix}-${var.environment}-" : null
  force_destroy = var.force_destroy

  tags = merge(
    local.common_tags,
    {
      Name = var.bucket_name != null ? var.bucket_name : "${var.bucket_name_prefix}-${var.environment}"
    }
  )
}

# ------------------------------------------------------------------------------
# 2. S3 Bucket Versioning Configuration
# Protects against inadvertent media segment deletion or corruption
# ------------------------------------------------------------------------------
resource "aws_s3_bucket_versioning" "versioning" {
  bucket = aws_s3_bucket.origin.id

  versioning_configuration {
    status = var.versioning_enabled ? "Enabled" : "Suspended"
  }
}

# ------------------------------------------------------------------------------
# 3. S3 Bucket Server-Side Encryption Configuration
# Supports AES256 or KMS with S3 Bucket Keys enabled to reduce KMS request costs
# ------------------------------------------------------------------------------
resource "aws_s3_bucket_server_side_encryption_configuration" "encryption" {
  bucket = aws_s3_bucket.origin.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.sse_algorithm
      kms_master_key_id = var.sse_algorithm == "aws:kms" ? var.kms_master_key_id : null
    }
    # Bucket Keys decrease AWS KMS request traffic by up to 99%
    bucket_key_enabled = true
  }
}

# ------------------------------------------------------------------------------
# 4. S3 Bucket Public Access Block (100% Private Origin)
# Prevents public ACLs and bucket policies to eliminate accidental data exposure
# ------------------------------------------------------------------------------
resource "aws_s3_bucket_public_access_block" "public_access_block" {
  bucket = aws_s3_bucket.origin.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ------------------------------------------------------------------------------
# 5. S3 Bucket CORS Configuration
# Supports byte-range requests for HLS/DASH video players, modern browsers,
# and edge streaming proxies
# ------------------------------------------------------------------------------
resource "aws_s3_bucket_cors_configuration" "cors" {
  bucket = aws_s3_bucket.origin.id

  cors_rule {
    id              = "AllowStreamingVideoClients"
    allowed_headers = var.cors_allowed_headers
    allowed_methods = var.cors_allowed_methods
    allowed_origins = var.cors_allowed_origins
    expose_headers  = var.cors_expose_headers
    max_age_seconds = var.cors_max_age_seconds
  }
}

# ------------------------------------------------------------------------------
# 6. S3 Bucket Lifecycle Configuration
# Automatic tiering to Standard-IA and Glacier Flexible, plus aborting incomplete uploads
# ------------------------------------------------------------------------------
resource "aws_s3_bucket_lifecycle_configuration" "lifecycle" {
  depends_on = [aws_s3_bucket_versioning.versioning]
  bucket     = aws_s3_bucket.origin.id

  # Clean up abandoned multipart uploads to avoid storage leakage
  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = var.abort_incomplete_multipart_upload_days
    }
  }

  # Tiering transitions for older media files
  rule {
    id     = "media-tiered-transitions"
    status = var.enable_lifecycle_transitions ? "Enabled" : "Disabled"

    transition {
      days          = var.transition_days_standard_ia
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = var.transition_days_glacier
      storage_class = "GLACIER"
    }

    # Versioning management: transition noncurrent versions to lower cost storage
    dynamic "noncurrent_version_transition" {
      for_each = var.versioning_enabled ? [1] : []
      content {
        noncurrent_days = var.transition_days_standard_ia
        storage_class   = "STANDARD_IA"
      }
    }

    dynamic "noncurrent_version_transition" {
      for_each = var.versioning_enabled ? [1] : []
      content {
        noncurrent_days = var.transition_days_glacier
        storage_class   = "GLACIER"
      }
    }

    # Expire noncurrent versions if configured
    dynamic "noncurrent_version_expiration" {
      for_each = var.versioning_enabled && var.noncurrent_version_expiration_days > 0 ? [1] : []
      content {
        noncurrent_days = var.noncurrent_version_expiration_days
      }
    }
  }
}

# ------------------------------------------------------------------------------
# 7. S3 Intelligent-Tiering Configuration
# Enables Archive Access and Deep Archive Access tiers for dynamic workloads
# ------------------------------------------------------------------------------
resource "aws_s3_bucket_intelligent_tiering_configuration" "intelligent_tiering" {
  count  = var.enable_intelligent_tiering ? 1 : 0
  bucket = aws_s3_bucket.origin.id
  name   = "EntireBucketIntelligentTiering"
  status = "Enabled"

  tiering {
    access_tier = "ARCHIVE_ACCESS"
    days        = var.intelligent_tiering_archive_days
  }

  tiering {
    access_tier = "DEEP_ARCHIVE_ACCESS"
    days        = var.intelligent_tiering_deep_archive_days
  }
}

# ------------------------------------------------------------------------------
# 8. S3 Bucket Request Metrics Configuration
# Emits detailed 1-minute CloudWatch metrics (4xx, 5xx, BytesDownloaded, Latency)
# ------------------------------------------------------------------------------
resource "aws_s3_bucket_metric" "origin_metrics" {
  bucket = aws_s3_bucket.origin.id
  name   = "EntireBucket"
}

# ------------------------------------------------------------------------------
# 9. Dedicated Least-Privilege IAM User & Access Key for Edge Worker
# ------------------------------------------------------------------------------
resource "aws_iam_user" "edge_router" {
  name = local.iam_user_name
  path = "/edge-router/"

  tags = merge(
    local.common_tags,
    {
      Purpose = "Cloudflare Worker SigV4 S3 Origin Authentication"
    }
  )
}

resource "aws_iam_access_key" "edge_router" {
  user = aws_iam_user.edge_router.name
}

# Least-privilege IAM policy strictly limited to GET and LIST on the bucket
resource "aws_iam_policy" "edge_router_s3" {
  name        = "${local.iam_user_name}-s3-read"
  description = "Least-privilege policy granting Cloudflare Edge Router read-only access to S3 media origin"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowBucketListing"
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = aws_s3_bucket.origin.arn
      },
      {
        Sid    = "AllowMediaObjectReads"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion"
        ]
        Resource = local.allowed_object_arns
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_user_policy_attachment" "edge_router_attach" {
  user       = aws_iam_user.edge_router.name
  policy_arn = aws_iam_policy.edge_router_s3.arn
}

# ------------------------------------------------------------------------------
# 10. S3 Bucket Policy
# Enforces TLS/HTTPS in transit and restricts origin access to dedicated IAM user
# ------------------------------------------------------------------------------
resource "aws_s3_bucket_policy" "origin_policy" {
  bucket     = aws_s3_bucket.origin.id
  depends_on = [aws_s3_bucket_public_access_block.public_access_block]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnforceSecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.origin.arn,
          "${aws_s3_bucket.origin.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
      {
        Sid    = "AllowDedicatedEdgeRouterUser"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_user.edge_router.arn
        }
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.origin.arn,
          "${aws_s3_bucket.origin.arn}/*"
        ]
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# 11. CloudWatch Metric Alarms
# ------------------------------------------------------------------------------

# Alarm: High 4xx Client Errors (potential 404 missing segments, 403 SigV4 token expiry)
resource "aws_cloudwatch_metric_alarm" "high_4xx_errors" {
  alarm_name          = "${aws_s3_bucket.origin.id}-high-4xx-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "4xxErrors"
  namespace           = "AWS/S3"
  period              = 300 # 5 minutes
  statistic           = "Sum"
  threshold           = var.alarm_4xx_threshold
  alarm_description   = "Elevated 4xx client errors on S3 media origin bucket. May indicate missing HLS/DASH segments, expired tokens, or bad requests from Cloudflare Worker."
  treat_missing_data  = "notBreaching"

  dimensions = {
    BucketName = aws_s3_bucket.origin.id
    FilterId   = aws_s3_bucket_metric.origin_metrics.name
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

# Alarm: High 5xx Server Errors (S3 service degradation or throttling SlowDown responses)
resource "aws_cloudwatch_metric_alarm" "high_5xx_errors" {
  alarm_name          = "${aws_s3_bucket.origin.id}-high-5xx-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "5xxErrors"
  namespace           = "AWS/S3"
  period              = 300 # 5 minutes
  statistic           = "Sum"
  threshold           = var.alarm_5xx_threshold
  alarm_description   = "High 5xx server errors on S3 media origin bucket. Indicates AWS S3 partition throttling (503 SlowDown) or internal S3 service degradation."
  treat_missing_data  = "notBreaching"

  dimensions = {
    BucketName = aws_s3_bucket.origin.id
    FilterId   = aws_s3_bucket_metric.origin_metrics.name
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

# Alarm: Excessive Data Egress (indicates edge cache bypass, R2 cache miss storm, or crawler)
resource "aws_cloudwatch_metric_alarm" "excessive_data_egress" {
  alarm_name          = "${aws_s3_bucket.origin.id}-excessive-egress"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "BytesDownloaded"
  namespace           = "AWS/S3"
  period              = 300 # 5 minutes
  statistic           = "Sum"
  threshold           = var.alarm_egress_threshold_bytes
  alarm_description   = "Excessive data egress downloaded from S3 origin. Indicates edge R2 cache misses, cache-bypass storm, or runaway crawler traffic."
  treat_missing_data  = "notBreaching"

  dimensions = {
    BucketName = aws_s3_bucket.origin.id
    FilterId   = aws_s3_bucket_metric.origin_metrics.name
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}
