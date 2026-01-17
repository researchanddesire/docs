#!/bin/bash

# Merge Documentation from KinkyMakers/OSSM-hardware into Documentation/ossm
# Also merges the "Open Source Sex Machine" product entry from remote docs.json
# Always takes "theirs" (remote version overwrites local)

set -e

OWNER="KinkyMakers"
REPO="OSSM-hardware"
REF="aj/mintlify-docs"
SUBDIRECTORY="Documentation/ossm"
TARGET_DIR="Documentation/ossm"
DOCS_JSON_PATH="Documentation/docs.json"
PRODUCT_NAME="Open Source Sex Machine"

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
git remote add origin "https://github.com/$OWNER/$REPO.git"

# Configure sparse checkout - include both ossm dir and docs.json
git sparse-checkout init --cone
git sparse-checkout set "$SUBDIRECTORY" "$DOCS_JSON_PATH"

# Fetch and checkout the specific ref
git fetch --depth=1 origin "$REF"
git checkout FETCH_HEAD

# Go back to project root
cd "$PROJECT_ROOT"

# Merge the "Open Source Sex Machine" product from remote docs.json into local
REMOTE_DOCS="$TEMP_CLONE/$DOCS_JSON_PATH"
LOCAL_DOCS="$PROJECT_ROOT/$DOCS_JSON_PATH"

if [ -f "$REMOTE_DOCS" ] && [ -f "$LOCAL_DOCS" ]; then
  echo "Merging '$PRODUCT_NAME' product from remote docs.json..."
  
  # Extract the OSSM product from remote
  REMOTE_PRODUCT="$(jq --arg name "$PRODUCT_NAME" '.navigation.products[] | select(.product == $name)' "$REMOTE_DOCS")"
  
  if [ -n "$REMOTE_PRODUCT" ] && [ "$REMOTE_PRODUCT" != "null" ]; then
    # Replace the matching product in local docs.json (preserving position)
    jq --arg name "$PRODUCT_NAME" --argjson product "$REMOTE_PRODUCT" \
      '.navigation.products = [.navigation.products[] | if .product == $name then $product else . end]' \
      "$LOCAL_DOCS" > "$LOCAL_DOCS.tmp" && mv "$LOCAL_DOCS.tmp" "$LOCAL_DOCS"
    
    echo "Successfully merged '$PRODUCT_NAME' product into $DOCS_JSON_PATH"
  else
    echo "Warning: '$PRODUCT_NAME' product not found in remote docs.json"
  fi
else
  echo "Warning: docs.json not found (remote: $REMOTE_DOCS, local: $LOCAL_DOCS)"
fi

# Sync the remote Documentation/ossm into local Documentation/ossm
if [ -d "$TEMP_CLONE/$SUBDIRECTORY" ]; then
  echo "Syncing $SUBDIRECTORY to $TARGET_DIR (taking theirs exclusively)..."
  rsync -avc --delete "$TEMP_CLONE/$SUBDIRECTORY/" "$TARGET_DIR/"
  echo "Successfully merged $OWNER/$REPO/$SUBDIRECTORY into $TARGET_DIR"
else
  echo "Error: $SUBDIRECTORY not found in repository"
  rm -rf "$TEMP_CLONE"
  exit 1
fi

# Clean up temp directory
rm -rf "$TEMP_CLONE"

echo "Done!"
