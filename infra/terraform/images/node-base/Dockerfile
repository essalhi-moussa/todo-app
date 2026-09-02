# =============================================================================
#  Image de base des nœuds provisionnés par Terraform.
#
#  Objectif : obtenir des cibles qui se comportent comme de vraies VM Linux —
#  systemd comme PID 1 et un serveur SSH — afin qu'Ansible les configure
#  exactement comme dans le TP1 (inventaire hosts.ini + connexion SSH +
#  modules `apt` / `systemd`), sans hyperviseur ni 20 Go de disque par VM.
# =============================================================================
FROM ubuntu:24.04

# Indique à systemd qu'il tourne dans un conteneur : il désactive alors de
# lui-même les unités qui touchent au matériel (montages, horloge, firmware).
ENV container=docker
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        systemd systemd-sysv dbus dbus-user-session \
        openssh-server sudo \
        python3 python3-apt \
        ca-certificates curl gnupg lsb-release \
        iproute2 iputils-ping procps less nano tzdata \
    && rm -rf /var/lib/apt/lists/*

# Neutralise les unités qui n'ont aucun sens dans un conteneur et qui, sinon,
# échouent en boucle et polluent `systemctl status`.
RUN systemctl mask \
        systemd-firstboot.service \
        systemd-udevd.service \
        systemd-udev-trigger.service \
        systemd-resolved.service \
        systemd-timesyncd.service \
        systemd-networkd.service \
        console-getty.service \
        getty.target \
        e2scrub_reap.service

# Résolution DNS : on s'appuie sur le /etc/resolv.conf injecté par Docker,
# systemd-resolved étant masqué ci-dessus.
RUN rm -f /etc/resolv.conf.systemd

# --- Amorçage SSH ------------------------------------------------------------
# Terraform dépose la clé publique dans /etc/devops/authorized_keys via un bloc
# `upload`. L'unité bootstrap-ssh l'installe ensuite dans /root/.ssh avec les
# permissions strictes qu'exige OpenSSH, avant le démarrage de sshd.
RUN mkdir -p /run/sshd /etc/devops /root/.ssh && chmod 700 /root/.ssh

COPY bootstrap-ssh.sh /usr/local/sbin/bootstrap-ssh.sh
COPY bootstrap-ssh.service /etc/systemd/system/bootstrap-ssh.service

RUN chmod 0755 /usr/local/sbin/bootstrap-ssh.sh \
    && sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config \
    && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/'  /etc/ssh/sshd_config \
    && sed -i 's/^#\?UseDNS.*/UseDNS no/'                                  /etc/ssh/sshd_config \
    && systemctl enable ssh.service bootstrap-ssh.service

# SIGRTMIN+3 est le signal d'extinction propre de systemd ; sans cela
# `docker stop` attendrait le délai de grâce complet avant de tuer le nœud.
STOPSIGNAL SIGRTMIN+3

EXPOSE 22
CMD ["/sbin/init"]
