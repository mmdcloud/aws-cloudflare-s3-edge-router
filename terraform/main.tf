## -----------------------------------------------------------------------------
## High-Throughput Edge Media Streaming Router
## Cloudflare Workers + R2 Tiered Edge Cache + AWS S3 Media Origin
## -----------------------------------------------------------------------------

# Random suffix for deterministic, conflict-free S3 bucket naming
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

locals {
  origin_bucket_name = coalesce(
    var.bucket_name,
    "${var.bucket_name_prefix}-${var.environment}-${random_id.bucket_suffix.hex}"
  )
}

# -----------------------------------------------------------------------------
# Module: Observability & Operational Alerts
# Created first so its SNS Topic can receive CloudWatch metric alarm actions
# -----------------------------------------------------------------------------
module "observability" {
  source = "./modules/observability"

  aws_region                = var.region
  environment               = var.environment
  s3_bucket_name            = local.origin_bucket_name
  alert_email               = var.alert_email
  cloudflare_account_id     = var.cloudflare_account_id
  cloudflare_zone_id        = var.cloudflare_zone_id
  enable_cloudflare_logpush = var.enable_cloudflare_logpush
}

# -----------------------------------------------------------------------------
# Module: AWS S3 Media Origin Bucket & Dedicated IAM Edge Credentials
# -----------------------------------------------------------------------------
module "aws_s3_origin" {
  source = "./modules/aws-s3-origin"

  bucket_name        = local.origin_bucket_name
  bucket_name_prefix = var.bucket_name_prefix
  environment        = var.environment
  force_destroy      = var.force_destroy
  versioning_enabled = var.s3_versioning_enabled

  # Route operational alarms directly to the Observability SNS topic
  alarm_actions = [module.observability.sns_topic_arn]
  ok_actions    = [module.observability.sns_topic_arn]
}

# -----------------------------------------------------------------------------
# Module: Cloudflare R2 Hot Cache Tier (Zero Egress)
# -----------------------------------------------------------------------------
module "cloudflare_r2" {
  source = "./modules/cloudflare-r2"

  cloudflare_account_id = var.cloudflare_account_id
  bucket_name           = var.r2_bucket_name
  location              = var.r2_location
}

# -----------------------------------------------------------------------------
# Module: Cloudflare Edge Security, WAF Rate Limiting & Tiered Cache
# -----------------------------------------------------------------------------
module "cloudflare_edge_security" {
  source = "./modules/cloudflare-edge-security"

  cloudflare_zone_id           = var.cloudflare_zone_id
  enable_tiered_cache          = var.enable_tiered_cache
  enable_waf_rate_limiting     = var.enable_waf_rate_limiting
  manifest_rate_limit_requests = var.manifest_rate_limit_requests
  manifest_rate_limit_period   = var.manifest_rate_limit_period
  segment_rate_limit_requests  = var.segment_rate_limit_requests
  segment_rate_limit_period    = var.segment_rate_limit_period
  blocked_countries            = var.blocked_countries
  enable_geo_blocking          = var.enable_geo_blocking
}

# -----------------------------------------------------------------------------
# Module: Cloudflare Edge Security, WAF Rate Limiting & Tiered Cache
# -----------------------------------------------------------------------------
module "cloudflare_edge_security" {
  source = "./modules/cloudflare-edge-security"

  cloudflare_zone_id           = var.cloudflare_zone_id
  enable_tiered_cache          = var.enable_tiered_cache
  enable_waf_rate_limiting     = var.enable_waf_rate_limiting
  manifest_rate_limit_requests = var.manifest_rate_limit_requests
  manifest_rate_limit_period   = var.manifest_rate_limit_period
  segment_rate_limit_requests  = var.segment_rate_limit_requests
  segment_rate_limit_period    = var.segment_rate_limit_period
  blocked_countries            = var.blocked_countries
  enable_geo_blocking          = var.enable_geo_blocking
}

# -----------------------------------------------------------------------------
# Module: Cloudflare Worker Edge Media Streaming Router
# -----------------------------------------------------------------------------
module "cloudflare_worker" {
  source = "./modules/cloudflare-worker"

  cloudflare_account_id = var.cloudflare_account_id
  cloudflare_zone_id    = var.cloudflare_zone_id
  worker_name           = var.worker_name
  worker_script_path    = var.worker_script_path
  route_patterns        = var.route_patterns
  custom_domain         = var.custom_domain
  enable_custom_domain  = var.enable_custom_domain

  r2_bucket_name        = module.cloudflare_r2.bucket_name
  aws_region            = var.region
  s3_bucket_name        = module.aws_s3_origin.bucket_id
  aws_access_key_id     = module.aws_s3_origin.iam_access_key_id
  aws_secret_access_key = module.aws_s3_origin.iam_secret_access_key
  auth_secret_key       = var.auth_secret_key
  environment           = var.environment
}