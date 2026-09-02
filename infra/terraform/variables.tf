# ---------------------------------------------------------------- fournisseur
variable "docker_host" {
  description = "Point d'accès du démon Docker faisant office d'hyperviseur."
  type        = string
  default     = "unix:///var/run/docker.sock"
}

# ------------------------------------------------------------------- réseau
variable "network_name" {
  description = "Nom du réseau privé reliant les nœuds."
  type        = string
  default     = "devops-net"
}

variable "network_subnet" {
  description = "Sous-réseau du réseau privé (doit être libre sur l'hôte)."
  type        = string
  default     = "172.28.0.0/24"
}

variable "network_gateway" {
  description = "Passerelle du réseau privé."
  type        = string
  default     = "172.28.0.1"
}

# --------------------------------------------------------------------- nœuds
variable "jenkins_node" {
  description = "Caractéristiques du nœud d'intégration continue."
  type = object({
    name     = string
    ip       = string
    ssh_port = number
    ui_port  = number
    memory   = number # Mo
    cpus     = number
  })
  default = {
    name     = "node-jenkins"
    ip       = "172.28.0.10"
    ssh_port = 2222
    ui_port  = 8080
    memory   = 2048
    cpus     = 2
  }
}

variable "k8s_node" {
  description = "Caractéristiques du nœud Kubernetes / base de données."
  type = object({
    name           = string
    ip             = string
    ssh_port       = number
    http_port      = number # NGINX (reverse proxy vers le NodePort)
    postgres_port  = number
    apiserver_port = number # API server Kubernetes (minikube)
    memory         = number # Mo
    cpus           = number
  })
  default = {
    name           = "node-k8s"
    ip             = "172.28.0.11"
    ssh_port       = 2223
    http_port      = 8081
    postgres_port  = 5432
    apiserver_port = 8443
    memory         = 6144
    cpus           = 4
  }
}

# ------------------------------------------------------------------- accès SSH
variable "ssh_public_key_path" {
  description = <<-EOT
    Chemin de la clé publique injectée dans les nœuds. La clé privée
    correspondante reste dans ~/.ssh sous WSL et n'est jamais versionnée
    (voir infra/00-bootstrap-wsl.sh).
  EOT
  type        = string
  default     = "~/.ssh/devops_id_ed25519.pub"
}

variable "ansible_user" {
  description = "Compte utilisé par Ansible pour se connecter aux nœuds."
  type        = string
  default     = "root"
}

# -------------------------------------------------------------------- projet
variable "project" {
  description = "Préfixe/étiquette commune aux ressources du projet."
  type        = string
  default     = "todo-devops"
}
