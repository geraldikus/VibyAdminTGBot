#!/usr/bin/env bash
# Build locally, ship the image to the server, restart ONLY school-admin-bot.
# Usage: deploy/deploy.sh            (DEPLOY_HOST=root@209.250.251.138 by default)
set -euo pipefail

HOST="${DEPLOY_HOST:-root@209.250.251.138}"
IMAGE=school-admin-bot
REMOTE_DIR=/opt/school-admin
cd "$(dirname "$0")/.."

TAG="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain)" ]; then TAG="$TAG-dirty-$(date +%H%M%S)"; fi

echo "==> Building $IMAGE:$TAG (linux/amd64)"
docker buildx build --platform linux/amd64 -t "$IMAGE:$TAG" -t "$IMAGE:latest" --load .

echo "==> Uploading image to $HOST"
docker save "$IMAGE:$TAG" | gzip | ssh "$HOST" 'gunzip | docker load'
ssh "$HOST" "docker tag $IMAGE:$TAG $IMAGE:latest"

echo "==> Updating compose file"
scp deploy/docker-compose.yml "$HOST:$REMOTE_DIR/docker-compose.yml"

echo "==> Restarting school-admin-bot only"
ssh "$HOST" "cd $REMOTE_DIR && docker compose up -d --no-deps school-admin"

echo "==> Waiting for health"
for i in $(seq 1 30); do
  status="$(ssh "$HOST" "docker inspect -f '{{.State.Health.Status}}' school-admin-bot" || true)"
  if [ "$status" = "healthy" ]; then echo "healthy"; break; fi
  if [ "$i" = 30 ]; then
    echo "NOT healthy ($status). Logs:"; ssh "$HOST" 'docker logs --tail 50 school-admin-bot'; exit 1
  fi
  sleep 3
done

echo "==> Removing old $IMAGE images (keeps latest + 2 previous; other images untouched)"
ssh "$HOST" "docker images $IMAGE --format '{{.Tag}}' | grep -vE '^(latest|$TAG)\$' | tail -n +3 | xargs -r -I{} docker rmi $IMAGE:{}" || true

echo "Done: $IMAGE:$TAG"
