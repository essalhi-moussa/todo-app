# =============================================================================
#  Provisionnement de l'infrastructure — livrable 1 du projet
#
#  Terraform (déclaratif, agentless, push) crée :
#    - un réseau privé isolé avec adressage statique ;
#    - une image de nœud « type VM » (systemd comme PID 1 + serveur SSH) ;
#    - deux nœuds : node-jenkins (CI) et node-k8s (Kubernetes + BDD + web) ;
#    - des volumes qui survivent à la destruction/recréation des nœuds ;
#    - l'inventaire Ansible, généré depuis l'état réel de l'infrastructure.
#
#  La configuration logicielle (Docker, Git, minikube, PostgreSQL, NGINX,
#  Jenkins) est déléguée à Ansible : voir infra/ansible/site.yml.
# =============================================================================

locals {
  ssh_public_key = trimspace(file(pathexpand(var.ssh_public_key_path)))

  common_labels = {
    project     = var.project
    managed-by  = "terraform"
    environment = "lab"
  }
}

# ------------------------------------------------------------------- réseau
resource "docker_network" "devops" {
  name   = var.network_name
  driver = "bridge"

  ipam_config {
    subnet  = var.network_subnet
    gateway = var.network_gateway
  }

  options = {
    "com.docker.network.bridge.name" = "br-devops"
  }
}

# -------------------------------------------------------------------- image
resource "docker_image" "node_base" {
  name = "${var.project}/node-base:24.04"

  build {
    context    = "${path.module}/images/node-base"
    dockerfile = "Dockerfile"
    tag        = ["${var.project}/node-base:24.04"]
    label      = local.common_labels
  }

  # Sans ces déclencheurs Terraform considérerait l'image inchangée même après
  # modification du Dockerfile ou des scripts d'amorçage.
  triggers = {
    dockerfile = filesha256("${path.module}/images/node-base/Dockerfile")
    bootstrap  = filesha256("${path.module}/images/node-base/bootstrap-ssh.sh")
    unit       = filesha256("${path.module}/images/node-base/bootstrap-ssh.service")
  }
}

# ------------------------------------------------------------------ volumes

# Données Jenkins : jobs, historique des builds, identifiants chiffrés.
resource "docker_volume" "jenkins_home" {
  name = "${var.project}-jenkins-home"

  labels {
    label = "project"
    value = var.project
  }
}

# Stockage du démon Docker interne au nœud Kubernetes. Indispensable : sans
# volume dédié, le Docker imbriqué empilerait overlayfs sur overlayfs et
# refuserait de démarrer.
resource "docker_volume" "k8s_docker_lib" {
  name = "${var.project}-k8s-docker-lib"

  labels {
    label = "project"
    value = var.project
  }
}

# Données PostgreSQL du nœud : base d'intégration, distincte de la base de
# production qui vit dans le PersistentVolume Kubernetes.
resource "docker_volume" "k8s_pgdata" {
  name = "${var.project}-k8s-pgdata"

  labels {
    label = "project"
    value = var.project
  }
}

# ================================================================== nœud CI
resource "docker_container" "jenkins" {
  name     = var.jenkins_node.name
  hostname = var.jenkins_node.name
  image    = docker_image.node_base.image_id

  # systemd comme PID 1 : les rôles Ansible peuvent piloter les services avec
  # le module `systemd` (enabled / started) exactement comme sur une VM.
  command     = ["/sbin/init"]
  privileged  = true
  restart     = "unless-stopped"
  must_run    = true
  stop_signal = "SIGRTMIN+3"

  memory  = var.jenkins_node.memory
  cpu_set = "0-${var.jenkins_node.cpus - 1}"

  networks_advanced {
    name         = docker_network.devops.name
    ipv4_address = var.jenkins_node.ip
    aliases      = [var.jenkins_node.name]
  }

  ports {
    internal = 22
    external = var.jenkins_node.ssh_port
  }

  ports {
    internal = 8080
    external = var.jenkins_node.ui_port
  }

  ports {
    internal = 50000
    external = 50000
  }

  # systemd exige des tmpfs inscriptibles sur /run et /run/lock.
  tmpfs = {
    "/run"      = "rw,noexec,nosuid,size=256m"
    "/run/lock" = "rw,noexec,nosuid,size=16m"
  }

  volumes {
    volume_name    = docker_volume.jenkins_home.name
    container_path = "/var/lib/jenkins"
  }

  upload {
    file    = "/etc/devops/authorized_keys"
    content = local.ssh_public_key
  }

  labels {
    label = "project"
    value = var.project
  }

  labels {
    label = "role"
    value = "ci"
  }
}

# =========================================================== nœud Kubernetes
resource "docker_container" "k8s" {
  name     = var.k8s_node.name
  hostname = var.k8s_node.name
  image    = docker_image.node_base.image_id

  command     = ["/sbin/init"]
  privileged  = true # requis par le Docker imbriqué qui porte minikube
  restart     = "unless-stopped"
  must_run    = true
  stop_signal = "SIGRTMIN+3"

  memory  = var.k8s_node.memory
  cpu_set = "0-${var.k8s_node.cpus - 1}"

  networks_advanced {
    name         = docker_network.devops.name
    ipv4_address = var.k8s_node.ip
    aliases      = [var.k8s_node.name]
  }

  ports {
    internal = 22
    external = var.k8s_node.ssh_port
  }

  # NGINX, qui relaie le NodePort du cluster.
  ports {
    internal = 80
    external = var.k8s_node.http_port
  }

  ports {
    internal = 5432
    external = var.k8s_node.postgres_port
  }

  # API server de minikube, publiée pour que le nœud Jenkins (et l'opérateur
  # depuis WSL) puissent exécuter kubectl contre le cluster.
  ports {
    internal = var.k8s_node.apiserver_port
    external = var.k8s_node.apiserver_port
  }

  tmpfs = {
    "/run"      = "rw,noexec,nosuid,size=256m"
    "/run/lock" = "rw,noexec,nosuid,size=16m"
  }

  volumes {
    volume_name    = docker_volume.k8s_docker_lib.name
    container_path = "/var/lib/docker"
  }

  volumes {
    volume_name    = docker_volume.k8s_pgdata.name
    container_path = "/var/lib/postgresql"
  }

  upload {
    file    = "/etc/devops/authorized_keys"
    content = local.ssh_public_key
  }

  labels {
    label = "project"
    value = var.project
  }

  labels {
    label = "role"
    value = "kubernetes"
  }
}

# ======================================================= inventaire Ansible
# L'inventaire est généré depuis l'état Terraform : il ne peut pas décrire une
# infrastructure qui n'existe pas (aucune dérive possible entre les deux).
resource "local_file" "ansible_inventory" {
  filename        = "${path.module}/../ansible/inventory/hosts.ini"
  file_permission = "0644"

  content = templatefile("${path.module}/templates/hosts.ini.tftpl", {
    ansible_user = var.ansible_user
    ssh_key      = replace(var.ssh_public_key_path, ".pub", "")

    jenkins_name = docker_container.jenkins.name
    jenkins_ip   = var.jenkins_node.ip
    jenkins_ui   = var.jenkins_node.ui_port

    k8s_name    = docker_container.k8s.name
    k8s_ip      = var.k8s_node.ip
    k8s_http    = var.k8s_node.http_port
    k8s_pg_port = var.k8s_node.postgres_port
  })
}
