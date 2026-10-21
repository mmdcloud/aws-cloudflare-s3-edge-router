output "bucket_name" {
  description = "The name of the provisioned Cloudflare R2 bucket"
  value       = cloudflare_r2_bucket.hot_media_cache.name
}

output "bucket_id" {
  description = "The ID of the provisioned Cloudflare R2 bucket"
  value       = cloudflare_r2_bucket.hot_media_cache.id
}

