# =============================================================================
#  Image de l'application TODO — build multi-étapes
#  Étape 1 (deps)  : dépendances de production uniquement
#  Étape 2 (test)  : dépendances complètes + suite de tests (cible optionnelle
#                    utilisée par le pipeline pour tester dans un conteneur)
#  Étape 3 (final) : image runtime minimale, non-root
# =============================================================================

# ------------------------------------------------------------------ étape deps
FROM node:20-alpine AS deps
WORKDIR /app
# On copie d'abord les manifestes : la couche de dépendances n'est réinvalidée
# que lorsque package.json / package-lock.json changent, pas à chaque commit.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ------------------------------------------------------------------ étape test
FROM node:20-alpine AS test
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY tests ./tests
ENV STORE_DRIVER=memory
RUN npm run test:ci

# ----------------------------------------------------------------- étape final
FROM node:20-alpine AS final

# Métadonnées OCI, renseignées par le pipeline Jenkins.
ARG APP_VERSION=dev
ARG GIT_COMMIT=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="todo-devops" \
      org.opencontainers.image.description="Application web de gestion des tâches" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="MIT"

# wget sert à la HEALTHCHECK ; sans lui l'image alpine n'a aucun client HTTP.
RUN apk add --no-cache wget

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# node:alpine fournit déjà un utilisateur non privilégié « node » (uid 1000).
# Faire tourner le process sous cet utilisateur satisfait la contrainte
# runAsNonRoot du securityContext Kubernetes.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["node", "src/server.js"]
