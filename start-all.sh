#!/bin/bash

# Start both frontend and backend (with MongoDB)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACK_DIR="$REPO_DIR/Back"
FRONT_DIR="$REPO_DIR/Front"
MONGO_IMAGE="mongo:latest"
DEBUG_MODE=false

for arg in "$@"; do
    case "$arg" in
        --debug-mode)
            DEBUG_MODE=true
            ;;
        --help|-h)
            echo "Usage: ./start-all.sh [--debug-mode]"
            echo "  --debug-mode  Start the frontend with the in-app debug modal enabled"
            exit 0
            ;;
    esac
done

# Kill any process using port 5000 (backend) and 3000 (frontend)
echo "Cleaning up ports..."
lsof -ti :5000 | xargs -r kill -9 2>/dev/null || true
lsof -ti :3000 | xargs -r kill -9 2>/dev/null || true
sleep 1

echo "Installing dependencies (with npm cache)..."
cd "$BACK_DIR" || exit 1
# npm install --prefer-offline
cd "$FRONT_DIR" || exit 1
# npm install --prefer-offline
cd "$BACK_DIR" || exit 1

echo "Enabling and starting Docker service..."

# Enable docker to start on boot
sudo systemctl enable docker 2>/dev/null || true

# Start docker if not running
sudo systemctl start docker 2>/dev/null || true

# Check if docker is running
if ! sudo systemctl is-active --quiet docker; then
    echo "Warning: Docker service failed to start"
    exit 1
fi

echo "Docker service is running"

echo "Checking if MongoDB image exists..."

docker image inspect "$MONGO_IMAGE" >/dev/null 2>&1 || docker pull "$MONGO_IMAGE"

echo "Starting MongoDB..."
cd "$BACK_DIR" || exit 1
docker compose up -d
echo "MongoDB started"

echo "Waiting for MongoDB to init..."
sleep 3

echo "Starting backend..."
npm start &
BACK_PID=$!
echo "Backend started (PID: $BACK_PID)"

echo "Starting frontend..."
cd "$FRONT_DIR" || exit 1
if [ "$DEBUG_MODE" = true ]; then
    npm run dev:debug -- --strictPort &
else
    npm run dev -- --strictPort &
fi
FRONT_PID=$!
echo "Frontend started (PID: $FRONT_PID)"

echo "Both services running. Press Ctrl+C to stop all."
echo "Frontend: http://localhost:3000"
echo "Backend:  http://localhost:5000/api/v1"

# Handle cleanup on exit
trap "kill $BACK_PID $FRONT_PID 2>/dev/null; cd $BACK_DIR && docker compose down; echo 'Services stopped.'" EXIT

# Keep open
wait
