#!/bin/bash

echo "🚀 Deploying Trend4Media Complete System"
echo "======================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if command was successful
check_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ $1 successful${NC}"
    else
        echo -e "${RED}❌ $1 failed${NC}"
        exit 1
    fi
}

# Step 1: Build TypeScript functions
echo -e "\n${YELLOW}Step 1: Building TypeScript functions...${NC}"
cd functions
npm run build
check_status "TypeScript build"
cd ..

# Step 2: Deploy Firestore rules
echo -e "\n${YELLOW}Step 2: Deploying Firestore rules...${NC}"
firebase deploy --only firestore:rules
check_status "Firestore rules deployment"

# Step 3: Deploy Storage rules
echo -e "\n${YELLOW}Step 3: Deploying Storage rules...${NC}"
echo "Skipping Storage rules deployment (manual configuration required)"
# firebase deploy --only storage:rules
# check_status "Storage rules deployment"

# Step 4: Deploy Cloud Functions
echo -e "\n${YELLOW}Step 4: Deploying Cloud Functions...${NC}"
firebase deploy --only functions
check_status "Cloud Functions deployment"

# Step 5: Build Frontend
echo -e "\n${YELLOW}Step 5: Building Frontend...${NC}"
cd trend4media-frontend
npm run build
check_status "Frontend build"
cd ..

# Step 6: Deploy Frontend
echo -e "\n${YELLOW}Step 6: Deploying Frontend to Firebase Hosting...${NC}"
firebase deploy --only hosting
check_status "Frontend deployment"

# Step 7: Test system health
echo -e "\n${YELLOW}Step 7: Testing system health...${NC}"
echo "Waiting 30 seconds for functions to initialize..."
sleep 30

# Test the API health endpoint
echo "Testing API health endpoint..."
curl -s https://europe-west1-trend4media-billing.cloudfunctions.net/api/health | jq '.' || echo "Health check not available yet"

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✅ DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "System URLs:"
echo "- Frontend: https://trend4media-billing.web.app"
echo "- API: https://europe-west1-trend4media-billing.cloudfunctions.net/api"
echo ""
echo "Next steps:"
echo "1. Test admin login at https://trend4media-billing.web.app/login"
echo "2. Upload a test Excel file"
echo "3. Check Firebase Console for logs"
echo ""
echo "Admin credentials:"
echo "- Email: admin@trend4media.com"
echo "- Password: [Check with system administrator]" 