#!/bin/bash
# Test GitHub Copilot API to see response structure
# This helps debug quota_snapshots issues

set -e

AUTH_FILE="$HOME/.local/share/opencode/auth.json"

if [ ! -f "$AUTH_FILE" ]; then
    echo "Error: auth.json not found at $AUTH_FILE"
    exit 1
fi

# Extract GitHub Copilot OAuth token
TOKEN=$(cat "$AUTH_FILE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'github-copilot' in data and 'refresh' in data['github-copilot']:
    print(data['github-copilot']['refresh'])
" 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
    echo "Error: Could not extract GitHub Copilot token from auth.json"
    exit 1
fi

echo "Testing GitHub Copilot API..."
echo ""

# Make API call and save response
RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/json" \
    -H "User-Agent: GitHubCopilotChat/0.35.0" \
    -H "Editor-Version: vscode/1.107.0" \
    -H "Editor-Plugin-Version: copilot-chat/0.35.0" \
    -H "Copilot-Integration-Id: vscode-chat" \
    "https://api.github.com/copilot_internal/user")

# Split response and HTTP code
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
    echo "Full response:"
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
else
    echo "Error response:"
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
fi
