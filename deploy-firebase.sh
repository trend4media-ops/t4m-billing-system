#!/bin/bash

# 🚀 T4M Firebase Deployment Script
# Replaces all the Docker/Railway complexity with simple Firebase deployment

set -e

echo "🔥 Starting Firebase Deployment for T4M Billing System..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo -e "${RED}❌ Firebase CLI not found. Installing...${NC}"
    npm install -g firebase-tools
fi

# Login check
echo -e "${BLUE}🔐 Checking Firebase authentication...${NC}"
if ! firebase projects:list &> /dev/null; then
    echo -e "${YELLOW}⚠️  Please login to Firebase first${NC}"
    firebase login
fi

# Install Functions dependencies
echo -e "${BLUE}📦 Installing Functions dependencies...${NC}"
cd functions
npm install
cd ..

# Build Frontend
echo -e "${BLUE}🏗️  Building Frontend...${NC}"
cd trend4media-frontend
npm install
npm run build
cd ..

# Deploy to Firebase
echo -e "${GREEN}🚀 Deploying to Firebase...${NC}"
firebase deploy

echo -e "${GREEN}✅ Firebase Deployment Complete!${NC}"
echo -e "${BLUE}📱 Your app is live at: https://your-project.web.app${NC}"
echo -e "${YELLOW}🔧 Configure your project ID in firebase.json if needed${NC}"

# Show helpful commands
echo -e "\n${BLUE}📋 Helpful Commands:${NC}"
echo "• View logs: firebase functions:log"
echo "• Local dev: firebase emulators:start"
echo "• Deploy only functions: firebase deploy --only functions"
echo "• Deploy only hosting: firebase deploy --only hosting" 