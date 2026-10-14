# Run in root of spec kit. Docker Desktop must be running.
docker compose --env-file .env -f scripts/compose.dev.yml up -d
docker compose --env-file .env -f scripts/compose.dev.yml ps
# Verify connection without executing any migrations
docker exec caicang-postgres pg_isready -U caicang -d caicang
