#!/bin/bash

echo "🧪 Testing Nixpacks build simulation locally..."
echo "=================================="

# Clean install test
echo "1. Testing clean npm ci..."
cd trend4media-backend
rm -rf node_modules
npm ci --no-audit --no-fund --prefer-offline --production=false

if [ $? -eq 0 ]; then
    echo "✅ npm ci successful"
else
    echo "❌ npm ci failed"
    exit 1
fi

# Build test  
echo "2. Testing build..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ Build successful"
else
    echo "❌ Build failed"
    exit 1
fi

echo "=================================="
echo "🎉 All tests passed! Ready to deploy."
echo ""
echo "Next steps:"
echo "1. git push origin main"
echo "2. Trigger new deploy on Railway" 