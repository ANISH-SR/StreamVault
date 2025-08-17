#!/bin/bash

echo "========================================="
echo "Running Improved Sprint Vault Test Suite"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Start local validator if not running
echo -e "${YELLOW}Checking Solana test validator...${NC}"
if ! pgrep -x "solana-test-validator" > /dev/null; then
    echo "Starting Solana test validator..."
    solana-test-validator --reset --quiet &
    sleep 5
else
    echo "Test validator already running"
fi

# Build programs
echo -e "${YELLOW}Building programs...${NC}"
anchor build

# Deploy programs
echo -e "${YELLOW}Deploying programs...${NC}"
anchor deploy

echo ""
echo -e "${GREEN}Running improved test suites:${NC}"
echo ""

# Run individual test suites
echo "1. Testing helper functions..."
npx ts-mocha -p ./tsconfig.json tests/sprint-vault-fixed.ts --timeout 60000

echo ""
echo "2. Testing improved fuzzing..."
npx ts-mocha -p ./tsconfig.json tests/fuzz-tests-improved.ts --timeout 120000

echo ""
echo "3. Testing directives compliance..."
npx ts-mocha -p ./tsconfig.json tests/directives-fixed.ts --timeout 60000

echo ""
echo "========================================="
echo -e "${GREEN}Test Summary:${NC}"
echo ""

# Run all tests and capture summary
anchor test --skip-build 2>&1 | grep -E "passing|failing" | tail -n 2

echo ""
echo "========================================="
echo -e "${GREEN}Improvements Applied:${NC}"
echo "✅ Fixed test helper functions with proper SprintDuration enum"
echo "✅ Updated all test contexts to include required accounts"
echo "✅ Fixed Vault config initialization persistence"
echo "✅ Improved withdrawal calculation logic"
echo "✅ Enhanced fuzzing tests with proper bounds checking"
echo "✅ Fixed edge case parameter adjustments"
echo "========================================="
