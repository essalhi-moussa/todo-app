// =============================================================================
//  Pipeline CI/CD — livrable 3 du projet
//
//  Enchaîne les cinq étapes demandées par le sujet :
//     1. cloner le dépôt              -> stage « Checkout »
//     2. lancer les tests unitaires    -> stage « Tests unitaires »
//     3. construire l'image Docker     -> stage « Build image Docker »
//     4. pousser l'image vers DockerHub-> stage « Push DockerHub »
//     5. déployer sur Kubernetes       -> stage « Déploiement Kubernetes »
//
//  Pipeline déclaratif (syntaxe du TP3), exécuté sur le nœud node-jenkins
//  provisionné par Terraform et configuré par Ansible.
// =============================================================================

pipeline {
    agent any

    parameters {
        string(
            name: 'DOCKERHUB_USER',
            // À REMPLACER par votre identifiant DockerHub, ici ou au lancement
            // du build. Une valeur explicitement fausse est préférable à un
            // compte plausible : le push échoue franchement au lieu de viser
            // silencieusement le mauvais dépôt.
            defaultValue: 'votre-compte-dockerhub',
            description: 'Compte DockerHub propriétaire du dépôt d\'images.'
        )
        booleanParam(
            name: 'PUSH_IMAGE',
            defaultValue: true,
            description: 'Publier l\'image sur DockerHub (décocher pour un build hors ligne).'
        )
        booleanParam(
            name: 'DEPLOY_TO_K8S',
            defaultValue: true,
            description: 'Déployer sur le cluster Kubernetes après un build réussi.'
        )
    }

    environment {
        IMAGE_NAME   = "${params.DOCKERHUB_USER}/todo-devops"
        K8S_NAMESPACE = 'todo-app'
        // Le kubeconfig est déposé par Ansible (playbook site.yml, étape 4).
        KUBECONFIG   = '/var/lib/jenkins/.kube/config'
        // Identifiants DockerHub enregistrés dans Jenkins sous cet identifiant
        // (Manage Jenkins > Credentials > « Username with password »).
        DOCKERHUB_CREDENTIALS = 'dockerhub-credentials'
        // Désactive les données de télémétrie npm : accélère npm ci en CI.
        NPM_CONFIG_FUND  = 'false'
        NPM_CONFIG_AUDIT = 'false'
    }

    options {
        // Horodate chaque ligne de console : permet d'identifier l'étape lente.
        timestamps()
        // Un build bloqué ne doit pas immobiliser le nœud indéfiniment.
        timeout(time: 30, unit: 'MINUTES')
        // Deux builds simultanés se disputeraient le démon Docker et le cluster.
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        // L'agent ne clone pas automatiquement : c'est l'étape « Checkout »
        // qui le fait explicitement. Sans cela le dépôt serait cloné deux fois.
        skipDefaultCheckout(true)
    }

    stages {

        // ------------------------------------------------------------- 1. clone
        stage('Checkout') {
            steps {
                // `checkout scm` reprend la configuration Git du job : c'est ce
                // qui permet au même Jenkinsfile de servir main et dev.
                checkout scm

                script {
                    env.GIT_COMMIT_SHORT = sh(
                        script: 'git rev-parse --short HEAD',
                        returnStdout: true
                    ).trim()
                    env.GIT_BRANCH_NAME = sh(
                        script: 'git rev-parse --abbrev-ref HEAD',
                        returnStdout: true
                    ).trim()
                    // Tag immuable : un numéro de build ne suffit pas à
                    // retrouver le code, un SHA seul ne donne pas l'ordre.
                    env.IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT_SHORT}"
                    env.BUILD_DATE = sh(
                        script: 'date -u +%Y-%m-%dT%H:%M:%SZ',
                        returnStdout: true
                    ).trim()

                    currentBuild.displayName = "#${env.BUILD_NUMBER} ${env.GIT_COMMIT_SHORT}"
                    currentBuild.description = "branche ${env.GIT_BRANCH_NAME}"
                }

                sh 'git --no-pager log -1 --pretty="format:commit %h — %an — %s%n"'
            }
        }

        // ------------------------------------------------------ 2. dépendances
        stage('Dépendances') {
            steps {
                dir('app') {
                    // npm ci (et non npm install) : installe exactement le
                    // contenu de package-lock.json, condition d'un build
                    // reproductible.
                    sh 'node --version && npm --version'
                    sh 'npm ci'
                }
            }
        }

        // --------------------------------------------------- 3. tests unitaires
        stage('Tests unitaires') {
            steps {
                dir('app') {
                    // STORE_DRIVER=memory : la suite tourne sans PostgreSQL,
                    // les tests restent rapides et sans dépendance externe.
                    withEnv(['STORE_DRIVER=memory', 'CI=true']) {
                        sh 'npm run test:ci'
                    }
                }
            }
            post {
                always {
                    // Publication du rapport JUnit, comme dans le TP3.
                    junit(
                        testResults: 'app/reports/junit.xml',
                        allowEmptyResults: false,
                        skipPublishingChecks: true
                    )
                    archiveArtifacts(
                        artifacts: 'app/reports/**',
                        allowEmptyArchive: true,
                        fingerprint: true
                    )
                }
            }
        }

        // ------------------------------------------------- 4. contrôles qualité
        stage('Analyse des dépendances') {
            steps {
                dir('app') {
                    // Le build n'échoue pas sur une vulnérabilité : le rapport
                    // est informatif, le durcir serait un choix d'équipe.
                    sh 'npm audit --audit-level=high --omit=dev || echo "AVERTISSEMENT: vulnérabilités détectées, voir ci-dessus"'
                }
            }
        }

        // ------------------------------------------------ 5. build image Docker
        stage('Build image Docker') {
            steps {
                script {
                    sh """
                        docker build \
                          --file app/Dockerfile \
                          --target final \
                          --build-arg APP_VERSION=${env.IMAGE_TAG} \
                          --build-arg GIT_COMMIT=${env.GIT_COMMIT_SHORT} \
                          --build-arg BUILD_DATE=${env.BUILD_DATE} \
                          --tag ${env.IMAGE_NAME}:${env.IMAGE_TAG} \
                          --tag ${env.IMAGE_NAME}:latest \
                          app
                    """
                    sh "docker image inspect ${env.IMAGE_NAME}:${env.IMAGE_TAG} --format 'Image {{.RepoTags}} — taille {{.Size}} octets'"
                }
            }
        }

        // -------------------------------------------- 6. test de fumée du conteneur
        stage('Test de l\'image') {
            steps {
                script {
                    // Vérifie que l'image DÉMARRE réellement avant de la
                    // publier : un build réussi ne garantit pas un conteneur
                    // fonctionnel (variable manquante, entrypoint cassé…).
                    def container = "smoke-${env.BUILD_NUMBER}"
                    try {
                        sh """
                            docker run -d --name ${container} \
                              -e STORE_DRIVER=memory \
                              -e APP_VERSION=${env.IMAGE_TAG} \
                              ${env.IMAGE_NAME}:${env.IMAGE_TAG}
                        """
                        sh """
                            for i in \$(seq 1 20); do
                              if docker exec ${container} wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1; then
                                echo "Conteneur opérationnel après \${i} tentative(s)"
                                docker exec ${container} wget -qO- http://127.0.0.1:3000/health
                                exit 0
                              fi
                              sleep 2
                            done
                            echo "ERREUR: le conteneur ne répond pas sur /health"
                            docker logs ${container}
                            exit 1
                        """
                    } finally {
                        sh "docker rm -f ${container} >/dev/null 2>&1 || true"
                    }
                }
            }
        }

        // ------------------------------------------------- 7. push vers DockerHub
        stage('Push DockerHub') {
            when {
                allOf {
                    expression { params.PUSH_IMAGE }
                    // On ne publie que depuis les branches d'intégration :
                    // une branche de fonctionnalité n'a pas à polluer le registre.
                    anyOf {
                        branch 'main'
                        branch 'dev'
                        expression { env.GIT_BRANCH_NAME in ['main', 'dev'] }
                    }
                }
            }
            steps {
                withCredentials([usernamePassword(
                    credentialsId: env.DOCKERHUB_CREDENTIALS,
                    usernameVariable: 'DH_USER',
                    passwordVariable: 'DH_TOKEN'
                )]) {
                    // --password-stdin évite que le jeton apparaisse dans la
                    // liste des processus ou dans les journaux.
                    sh '''
                        echo "$DH_TOKEN" | docker login -u "$DH_USER" --password-stdin
                    '''
                    sh "docker push ${env.IMAGE_NAME}:${env.IMAGE_TAG}"
                    sh "docker push ${env.IMAGE_NAME}:latest"
                    sh 'docker logout'
                }
                echo "Image publiée : ${env.IMAGE_NAME}:${env.IMAGE_TAG}"
            }
        }

        // ------------------------------------------- 8. déploiement Kubernetes
        stage('Déploiement Kubernetes') {
            when {
                allOf {
                    expression { params.DEPLOY_TO_K8S }
                    anyOf {
                        branch 'main'
                        expression { env.GIT_BRANCH_NAME == 'main' }
                    }
                }
            }
            steps {
                script {
                    sh 'kubectl version --client --output=yaml | head -5'
                    sh 'kubectl cluster-info'

                    // Applique l'ensemble des manifestes : namespace, Secret,
                    // ConfigMap, PV/PVC, PostgreSQL, application, Service.
                    sh 'kubectl apply -k k8s/'

                    // Substitue l'image tout juste publiée. `kubectl set image`
                    // crée une nouvelle révision, donc un déploiement progressif
                    // (RollingUpdate) et un rollback possible.
                    sh """
                        kubectl -n ${env.K8S_NAMESPACE} set image \
                          deployment/todo-app todo-app=${env.IMAGE_NAME}:${env.IMAGE_TAG}
                        kubectl -n ${env.K8S_NAMESPACE} annotate deployment/todo-app \
                          kubernetes.io/change-cause="build #${env.BUILD_NUMBER} — commit ${env.GIT_COMMIT_SHORT}" \
                          --overwrite
                    """

                    // Attente bloquante : le stage échoue si la nouvelle version
                    // ne devient jamais Ready. C'est ce qui rend le rollback
                    // automatique possible dans le bloc post.
                    sh """
                        kubectl -n ${env.K8S_NAMESPACE} rollout status \
                          deployment/todo-postgres --timeout=180s
                        kubectl -n ${env.K8S_NAMESPACE} rollout status \
                          deployment/todo-app --timeout=240s
                    """
                }
            }
            post {
                failure {
                    // Stratégie de rollback automatique (cf. cours Livraison
                    // Continue : « prévoir des mécanismes de retour arrière »).
                    echo 'Déploiement en échec — retour à la révision précédente.'
                    sh """
                        kubectl -n ${env.K8S_NAMESPACE} rollout undo deployment/todo-app || true
                        kubectl -n ${env.K8S_NAMESPACE} rollout status deployment/todo-app --timeout=120s || true
                    """
                    sh """
                        kubectl -n ${env.K8S_NAMESPACE} get pods -o wide || true
                        kubectl -n ${env.K8S_NAMESPACE} describe deployment/todo-app || true
                    """
                }
            }
        }

        // ------------------------------------- 9. validation post-déploiement
        stage('Validation post-déploiement') {
            when {
                allOf {
                    expression { params.DEPLOY_TO_K8S }
                    anyOf {
                        branch 'main'
                        expression { env.GIT_BRANCH_NAME == 'main' }
                    }
                }
            }
            steps {
                script {
                    // Interroge l'application via le nom DNS du Service, donc
                    // en traversant CoreDNS et le Service comme le fait NGINX.
                    // On passe par un pod existant plutôt que par `kubectl run`
                    // : pas d'image supplémentaire à télécharger, et l'image de
                    //   l'application embarque déjà wget (cf. HEALTHCHECK).
                    sh """
                        POD=\$(kubectl -n ${env.K8S_NAMESPACE} get pod \
                                -l app.kubernetes.io/component=app \
                                -o jsonpath='{.items[0].metadata.name}')
                        echo "validation depuis le pod \$POD"
                        kubectl -n ${env.K8S_NAMESPACE} exec "\$POD" -- \
                          wget -qO- --timeout=10 http://todo-app/health
                        echo
                        kubectl -n ${env.K8S_NAMESPACE} exec "\$POD" -- \
                          wget -qO- --timeout=10 http://todo-app/ready
                        echo
                    """
                    sh """
                        echo '--- état du déploiement ---'
                        kubectl -n ${env.K8S_NAMESPACE} get deploy,pods,svc,pvc
                    """
                }
            }
        }
    }

    post {
        success {
            echo """
            ============================================================
             BUILD RÉUSSI — #${env.BUILD_NUMBER}
             Image      : ${env.IMAGE_NAME}:${env.IMAGE_TAG}
             Branche    : ${env.GIT_BRANCH_NAME}
             Application: http://localhost:8081
            ============================================================
            """.stripIndent()
        }
        failure {
            echo "BUILD EN ÉCHEC — #${env.BUILD_NUMBER}. Consulter la console ci-dessus."
        }
        always {
            // Supprime les images intermédiaires : sans cela le disque du nœud
            // sature au bout d'une vingtaine de builds.
            sh 'docker image prune -f --filter "until=24h" || true'
            cleanWs(
                deleteDirs: true,
                notFailBuild: true,
                patterns: [[pattern: 'app/node_modules', type: 'EXCLUDE']]
            )
        }
    }
}
