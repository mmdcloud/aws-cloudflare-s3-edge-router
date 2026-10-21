terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

# ------------------------------------------------------------------------------
# Workers KV Namespace for Revoked Playback Tokens
# ------------------------------------------------------------------------------
resource "cloudflare_workers_kv_namespace" "revoked_tokens" {
  account_id = var.cloudflare_account_id
  title      = "${var.worker_name}-revoked-tokens-${var.environment}"
}

# ------------------------------------------------------------------------------
# Workers KV Namespace for Dynamic Routing and Geo Rules
# ------------------------------------------------------------------------------
resource "cloudflare_workers_kv_namespace" "routing_config" {
  account_id = var.cloudflare_account_id
  title      = "${var.worker_name}-routing-config-${var.environment}"
}

# ------------------------------------------------------------------------------
# Cloudflare Worker Script (Edge Media Streaming Router)
# ------------------------------------------------------------------------------
resource "cloudflare_worker_script" "media_router" {
  account_id          = var.cloudflare_account_id
  name                = "${var.worker_name}-${var.environment}"
  content             = file(var.worker_script_path)
  compatibility_date  = "2024-04-01"
  compatibility_flags = ["nodejs_compat"]

  # Zero-Egress Cloudflare R2 Bucket Binding
  r2_bucket_binding {
    name        = "MEDIA_R2"
    bucket_name = var.r2_bucket_name
  }

  # KV Namespace Bindings
  kv_namespace_binding {
    name         = "REVOKED_TOKENS_KV"
    namespace_id = cloudflare_workers_kv_namespace.revoked_tokens.id
  }

  kv_namespace_binding {
    name         = "ROUTING_CONFIG_KV"
    namespace_id = cloudflare_workers_kv_namespace.routing_config.id
  }

  # AWS SigV4 Credentials & HMAC Secret Key (Never exposed to clients)
  secret_text_binding {
    name = "AWS_ACCESS_KEY_ID"
    text = var.aws_access_key_id
  }

  secret_text_binding {
    name = "AWS_SECRET_ACCESS_KEY"
    text = var.aws_secret_access_key
  }

  secret_text_binding {
    name = "AUTH_SECRET_KEY"
    text = var.auth_secret_key
  }

  # Plain text runtime settings
  plain_text_binding {
    name = "AWS_REGION"
    text = var.aws_region
  }

  plain_text_binding {
    name = "S3_BUCKET_NAME"
    text = var.s3_bucket_name
  }

  plain_text_binding {
    name = "CACHE_MANIFEST_TTL"
    text = tostring(var.cache_manifest_ttl)
  }

  plain_text_binding {
    name = "CACHE_SEGMENT_TTL"
    text = tostring(var.cache_segment_ttl)
  }

  plain_text_binding {
    name = "ASYNC_HYDRATION_ENABLED"
    text = tostring(var.async_hydration_enabled)
  }

  plain_text_binding {
    name = "FAILOVER_ENABLED"
    text = tostring(var.failover_enabled)
  }

  plain_text_binding {
    name = "ENVIRONMENT"
    text = var.environment
  }

  plain_text_binding {
    name = "ALLOWED_ORIGINS"
    text = var.allowed_origins
  }

  plain_text_binding {
    name = "ENABLE_GEO_STEERING"
    text = tostring(var.enable_geo_steering)
  }
}

# ------------------------------------------------------------------------------
# Route Patterns for Cloudflare Worker
# ------------------------------------------------------------------------------
resource "cloudflare_worker_route" "router_routes" {
  for_each    = toset(var.route_patterns)
  zone_id     = var.cloudflare_zone_id
  pattern     = each.value
  script_name = cloudflare_worker_script.media_router.name
}

# ------------------------------------------------------------------------------
# Optional Custom Domain Routing
# ------------------------------------------------------------------------------
resource "cloudflare_workers_custom_domain" "custom_domain" {
  count       = var.enable_custom_domain && var.custom_domain != "" ? 1 : 0
  account_id  = var.cloudflare_account_id
  zone_id     = var.cloudflare_zone_id
  hostname    = var.custom_domain
  service     = cloudflare_worker_script.media_router.name
  environment = var.environment
}

