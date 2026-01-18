#!/bin/bash

# Generic script to sync Documentation from a remote repository
# Merges the product entry from remote docs.json into local docs.json
# Always takes "theirs" (remote version overwrites local)
#
# Usage: ./sync-docs.sh <owner> <repo> <branch> <subdirectory> <target_dir> <product_name> [snippet_dir]
# Example: ./sync-docs.sh KinkyMakers OSSM-hardware main Documentation/ossm Documentation/ossm "Open Source Sex Machine" Documentation/snippets/ossm
#
# Environment variables:
#   GITHUB_TOKEN - Optional. If set, used for authenticated git operations (required for private repos)

set -e

# Parse arguments
OWNER="${1:?Error: OWNER is required}"
REPO="${2:?Error: REPO is required}"
REF="${3:?Error: REF (branch) is required}"
SUBDIRECTORY="${4:?Error: SUBDIRECTORY is required}"
TARGET_DIR="${5:?Error: TARGET_DIR is required}"
PRODUCT_NAME="${6:?Error: PRODUCT_NAME is required}"
SNIPPET_DIR="${7:-}"  # Optional snippet directory

DOCS_JSON_PATH="Documentation/docs.json"

# Build the git URL (with or without token)
if [ -n "$GITHUB_TOKEN" ]; then
  GIT_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/$OWNER/$REPO.git"
  AUTH_STATUS="authenticated"
else
  GIT_URL="https://github.com/$OWNER/$REPO.git"
  AUTH_STATUS="public (no token)"
fi

echo "========================================"
echo "Syncing docs from $OWNER/$REPO"
echo "  Branch: $REF"
echo "  Source: $SUBDIRECTORY"
echo "  Target: $TARGET_DIR"
echo "  Product: $PRODUCT_NAME"
if [ -n "$SNIPPET_DIR" ]; then
echo "  Snippets: $SNIPPET_DIR"
fi
echo "  Auth: $AUTH_STATUS"
echo "========================================"

# Get the directory where this script is located, then go to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Check for jq dependency
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required but not installed. Install with: brew install jq"
  exit 1
fi

# Create target directory if it doesn't exist
mkdir -p "$TARGET_DIR"

# Create a temporary directory for sparse checkout
TEMP_CLONE="$(mktemp -d)"
echo "Cloning $OWNER/$REPO (ref: $REF) with sparse checkout..."

# Initialize git repo with sparse checkout
cd "$TEMP_CLONE"
git init -q
git remote add origin "$GIT_URL"

# Configure sparse checkout - include source dir, docs.json, and optionally snippets
git sparse-checkout init --cone
if [ -n "$SNIPPET_DIR" ]; then
  git sparse-checkout set "$SUBDIRECTORY" "$DOCS_JSON_PATH" "$SNIPPET_DIR"
else
  git sparse-checkout set "$SUBDIRECTORY" "$DOCS_JSON_PATH"
fi

# Fetch and checkout the specific ref
git fetch --depth=1 origin "$REF"
git checkout FETCH_HEAD

# Go back to project root
cd "$PROJECT_ROOT"

# Merge the product from remote docs.json into local
REMOTE_DOCS="$TEMP_CLONE/$DOCS_JSON_PATH"
LOCAL_DOCS="$PROJECT_ROOT/$DOCS_JSON_PATH"

if [ -f "$REMOTE_DOCS" ] && [ -f "$LOCAL_DOCS" ]; then
  echo "Merging '$PRODUCT_NAME' product from remote docs.json..."
  
  # Extract the product from remote
  REMOTE_PRODUCT="$(jq --arg name "$PRODUCT_NAME" '.navigation.products[] | select(.product == $name)' "$REMOTE_DOCS")"
  
  if [ -n "$REMOTE_PRODUCT" ] && [ "$REMOTE_PRODUCT" != "null" ]; then
    # Replace the matching product in local docs.json (preserving position)
    jq --arg name "$PRODUCT_NAME" --argjson product "$REMOTE_PRODUCT" \
      '.navigation.products = [.navigation.products[] | if .product == $name then $product else . end]' \
      "$LOCAL_DOCS" > "$LOCAL_DOCS.tmp" && mv "$LOCAL_DOCS.tmp" "$LOCAL_DOCS"
    
    echo "Successfully merged '$PRODUCT_NAME' product into $DOCS_JSON_PATH"
  else
    echo "Warning: '$PRODUCT_NAME' product not found in remote docs.json (this is OK for new repos)"
  fi
else
  if [ ! -f "$REMOTE_DOCS" ]; then
    echo "Note: No docs.json found in remote repository (this is OK)"
  fi
  if [ ! -f "$LOCAL_DOCS" ]; then
    echo "Warning: Local docs.json not found at $LOCAL_DOCS"
  fi
fi

# Sync the remote documentation into local target directory
if [ -d "$TEMP_CLONE/$SUBDIRECTORY" ]; then
  echo "Syncing $SUBDIRECTORY to $TARGET_DIR (taking theirs exclusively)..."
  rsync -avc --delete "$TEMP_CLONE/$SUBDIRECTORY/" "$TARGET_DIR/"
  echo "Successfully merged $OWNER/$REPO/$SUBDIRECTORY into $TARGET_DIR"
else
  echo "Warning: $SUBDIRECTORY not found in repository $OWNER/$REPO"
  echo "This may be expected if the docs haven't been set up yet in the source repo"
fi

# Sync snippets if specified and present
if [ -n "$SNIPPET_DIR" ]; then
  TARGET_SNIPPET_DIR="$PROJECT_ROOT/$SNIPPET_DIR"
  if [ -d "$TEMP_CLONE/$SNIPPET_DIR" ]; then
    echo "Syncing snippets from $SNIPPET_DIR..."
    mkdir -p "$TARGET_SNIPPET_DIR"
    rsync -avc --delete "$TEMP_CLONE/$SNIPPET_DIR/" "$TARGET_SNIPPET_DIR/"
    echo "Successfully merged $OWNER/$REPO/$SNIPPET_DIR into $TARGET_SNIPPET_DIR"
  else
    echo "Note: $SNIPPET_DIR not found in repository $OWNER/$REPO (this is OK)"
  fi
fi

# Clean up temp directory
rm -rf "$TEMP_CLONE"

echo "Done syncing $OWNER/$REPO!"
echo ""
