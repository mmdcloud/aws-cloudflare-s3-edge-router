output "rate_limiting_ruleset_id" {
  description = "ID of the Cloudflare WAF rate limiting ruleset"
  value       = var.enable_waf_rate_limiting ? cloudflare_ruleset.media_rate_limiting[0].id : null
}

output "waf_custom_ruleset_id" {
  description = "ID of the Cloudflare custom WAF firewall ruleset"
  value       = var.enable_geo_blocking && length(var.blocked_countries) > 0 ? cloudflare_ruleset.media_waf_custom[0].id : null
}

output "cache_ruleset_id" {
  description = "ID of the Cloudflare edge cache ruleset"
  value       = cloudflare_ruleset.media_cache_rules.id
}

