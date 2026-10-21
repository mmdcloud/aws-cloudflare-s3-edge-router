output "worker_name" {
  description = "The name of the deployed Cloudflare Worker"
  value       = cloudflare_worker_script.media_router.name
}

output "revoked_tokens_kv_id" {
  description = "ID of the KV namespace for revoked tokens"
  value       = cloudflare_workers_kv_namespace.revoked_tokens.id
}

output "routing_config_kv_id" {
  description = "ID of the KV namespace for dynamic routing configs"
  value       = cloudflare_workers_kv_namespace.routing_config.id
}

output "worker_routes" {
  description = "List of assigned worker routes"
  value       = [for r in cloudflare_worker_route.router_routes : r.pattern]
}

output "custom_domain_hostname" {
  description = "Custom domain hostname attached to the worker"
  value       = var.enable_custom_domain && var.custom_domain != "" ? cloudflare_workers_custom_domain.custom_domain[0].hostname : null
}

