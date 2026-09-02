terraform {
  required_version = ">= 1.5.0"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.4"
    }
  }
}

# Le provider parle au démon Docker de l'hôte WSL2, qui joue ici le rôle
# d'hyperviseur / fournisseur d'infrastructure.
provider "docker" {
  host = var.docker_host
}
