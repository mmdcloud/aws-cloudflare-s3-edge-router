terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

# ------------------------------------------------------------------------------
# Cloudflare Smart Tiered Cache
# Minimizes origin hits by routing cache misses through upper-tier regional PoPs
# ------------------------------------------------------------------------------
resource "cloudflare_tiered_cache" "smart_tiered_cache" {
  count   = var.enable_tiered_cache ? 1 : 0
  zone_id = var.cloudflare_zone_id
  value   = "on"
}

# ------------------------------------------------------------------------------
# Cloudflare WAF Rate Limiting Ruleset
# Distinct thresholds for manifests (anti-scraping) vs video segments (playback)
# ------------------------------------------------------------------------------
resource "cloudflare_ruleset" "media_rate_limiting" {
  count       = var.enable_waf_rate_limiting ? 1 : 0
  zone_id     = var.cloudflare_zone_id
  name        = "Media Streaming Edge Rate Limiting"
  description = "Throttles abusive manifest scraping and segment leeching at edge PoPs"
  kind        = "zone"
  phase       = "http_ratelimit"

  # Rule 1: Manifest Rate Limiting (.m3u8, .mpd)
  # Manifests update frequently in live streaming, but excessive polling indicates scraping or DoS
  rules {
    ref         = "manifest_anti_scraping"
    description = "Rate limit HLS/DASH manifest playlist requests"
    expression  = "(ends_with(http.request.uri.path, \".m3u8\") or ends_with(http.request.uri.path, \".mpd\"))"
    enabled     = true
    action      = "managed_challenge"

    ratelimit {
      characteristics     = ["ip.src"]
      period              = var.manifest_rate_limit_period
      requests_per_period = var.manifest_rate_limit_requests
      mitigation_timeout  = 120
    }
  }

  # Rule 2: Media Segment Rate Limiting (.ts, .m4s, .mp4, .aac)
  # High threshold accommodating high-bitrate multi-chunk streaming
  rules {
    ref         = "segment_flood_protection"
    description = "Prevent aggressive segment scraping and stream leeching"
    expression  = "(ends_with(http.request.uri.path, \".ts\") or ends_with(http.request.uri.path, \".m4s\") or ends_with(http.request.uri.path, \".aac\"))"
    enabled     = true
    action      = "managed_challenge"

    ratelimit {
      characteristics     = ["ip.src"]
      period              = var.segment_rate_limit_period
      requests_per_period = var.segment_rate_limit_requests
      mitigation_timeout  = 60
    }
  }
}

# ------------------------------------------------------------------------------
# Cloudflare WAF Custom Firewall Rules (Geo-fencing & Bot Defense)
# ------------------------------------------------------------------------------
resource "cloudflare_ruleset" "media_waf_custom" {
  count       = var.enable_geo_blocking && length(var.blocked_countries) > 0 ? 1 : 0
  zone_id     = var.cloudflare_zone_id
  name        = "Media Streaming Edge Access Control"
  description = "Enforces geo-fencing policies before traffic reaches origin or workers"
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  rules {
    ref         = "edge_geo_fencing"
    description = "Block traffic from restricted jurisdictions"
    expression  = "(ip.geoip.country in {${join(" ", formatlist("\"%s\"", var.blocked_countries))}} and http.request.uri.path wildcard \"/stream/*\")"
    enabled     = true
    action      = "block"
  }
}

# ------------------------------------------------------------------------------
# Cloudflare Edge Cache Ruleset
# Optimizes caching rules for video segments vs playlists
# ------------------------------------------------------------------------------
resource "cloudflare_ruleset" "media_cache_rules" {
  zone_id     = var.cloudflare_zone_id
  name        = "Media Edge Caching Configuration"
  description = "Custom edge cache TTLs for immutable video segments"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules {
    ref         = "cache_media_segments"
    description = "Aggressively cache immutable video segments at edge"
    expression  = "(ends_with(http.request.uri.path, \".ts\") or ends_with(http.request.uri.path, \".m4s\"))"
    enabled     = true
    action      = "set_cache_settings"

    action_parameters {
      cache = true
      edge_ttl {
        mode    = "override_origin"
        default = 31536000 # 1 year
      }
      browser_ttl {
        mode    = "override_origin"
        default = 86400 # 1 day
      }
      respect_strong_etags = true
    }
  }
}

