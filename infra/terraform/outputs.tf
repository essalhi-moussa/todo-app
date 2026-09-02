output "network" {
  description = "Reseau prive reliant les noeuds."
  value = {
    name   = docker_network.devops.name
    subnet = var.network_subnet
  }
}

output "nodes" {
  description = "Noeuds provisionnes et leurs points d'acces."
  value = {
    (var.jenkins_node.name) = {
      ip      = var.jenkins_node.ip
      role    = "integration continue (Jenkins)"
      ssh     = "ssh -i ~/.ssh/devops_id_ed25519 ${var.ansible_user}@${var.jenkins_node.ip}"
      jenkins = "http://localhost:${var.jenkins_node.ui_port}"
    }
    (var.k8s_node.name) = {
      ip       = var.k8s_node.ip
      role     = "cluster Kubernetes (minikube) + PostgreSQL + NGINX"
      ssh      = "ssh -i ~/.ssh/devops_id_ed25519 ${var.ansible_user}@${var.k8s_node.ip}"
      app      = "http://localhost:${var.k8s_node.http_port}"
      postgres = "localhost:${var.k8s_node.postgres_port}"
    }
  }
}

output "ansible_inventory_path" {
  description = "Inventaire genere, a passer a ansible-playbook -i."
  value       = local_file.ansible_inventory.filename
}

output "next_step" {
  description = "Commande suivante du flux de provisionnement."
  value       = "cd infra/ansible && ansible-playbook -i inventory/hosts.ini site.yml"
}
