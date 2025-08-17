#!/bin/bash

echo "Running Sprint Vault tests and generating summary..."

# Run tests and capture output
OUTPUT=$(anchor test --skip-build 2>&1)

# Count passing and failing tests
PASSING=$(echo "$OUTPUT" | grep -E "✔|✓" | wc -l)
FAILING=$(echo "$OUTPUT" | grep -E "^\s+[0-9]+\)" | wc -l)
ERRORS=$(echo "$OUTPUT" | grep -E "Error:|error:" | wc -l)

echo "================================"
echo "Sprint Vault Test Summary"
echo "================================"
echo "✅ Passing tests: $PASSING"
echo "❌ Failing tests: $FAILING" 
echo "⚠️  Errors found: $ERRORS"
echo "================================"

# Show first few errors if any
if [ $FAILING -gt 0 ]; then
    echo -e "\nFirst few failing tests:"
    echo "$OUTPUT" | grep -E "^\s+[0-9]+\)" | head -5
fi

# Show exit code
EXIT_CODE=$?
echo -e "\nTest suite exit code: $EXIT_CODE"

if [ $FAILING -gt 0 ]; then
    echo -e "\n📌 Main issues to fix:"
    echo "1. SprintDuration enum parameter formatting"
    echo "2. Missing 'mint' account in withdraw operations"
    echo "3. Acceleration type parameter formatting"
fi
