#!/bin/bash
echo "🚀 Installing and building T4M Backend..."
cd trend4media-backend
npm ci
npm run build
echo "✅ Build completed successfully!" 