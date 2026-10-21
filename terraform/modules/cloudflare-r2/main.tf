terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

# ------------------------------------------------------------------------------
# Cloudflare R2 Bucket - Zero-Egress Replica Storage for Hot Media Assets
# ------------------------------------------------------------------------------
resource "cloudflare_r2_bucket" "hot_media_cache" {
  account_id = var.cloudflare_account_id
  name       = var.bucket_name
  location   = var.location
}

# ------------------------------------------------------------------------------
# Cloudflare R2 Bucket CORS Configuration
# Supports Range requests, HLS (.m3u8, .ts), DASH (.mpd, .m4s), and video players
# ------------------------------------------------------------------------------
resource "cloudflare_r2_bucket_cors" "hot_media_cors" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.hot_media_cache.name

  rules = [
    {
      id = "AllowStreamingClientCORS"
      allowed = {
        origins = var.cors_allowed_origins
        methods = ["GET", "HEAD", "OPTIONS"]
        headers = [
          "Range",
          "Authorization",
          "Content-Type",
          "Origin",
          "Accept",
          "X-Playback-Session-Id"
        ]
      }
      max_age_seconds = var.cors_max_age_seconds
    }
  ]
}

