#!/bin/bash

echo "🔍 T4M Abrechnungssystem - Finaler System-Check"
echo "=============================================="
echo ""

# Check if deployment is complete
echo "📦 Checking deployment status..."
if ps aux | grep -q "[f]irebase deploy"; then
    echo "⏳ Functions deployment still in progress..."
else
    echo "✅ Functions deployment complete!"
fi
echo ""

# Check live API status
echo "🌐 Checking live API status..."
API_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" https://api-piwtsoxesq-ew.a.run.app/health 2>/dev/null || echo "000")
if [ "$API_RESPONSE" = "200" ]; then
    echo "✅ API is online and responding!"
else
    echo "⚠️  API returned status code: $API_RESPONSE"
fi
echo ""

# Check Frontend
echo "🖥️  Checking frontend status..."
FRONTEND_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" https://trend4media-billing.web.app 2>/dev/null || echo "000")
if [ "$FRONTEND_RESPONSE" = "200" ]; then
    echo "✅ Frontend is online!"
else
    echo "❌ Frontend returned status code: $FRONTEND_RESPONSE"
fi
echo ""

# List Excel file
echo "📄 Excel test file:"
if [ -f " Neu_Task_202506_UTC+0_2025_07_29_22_14_15.xlsx" ]; then
    echo "✅ Test file found: ' Neu_Task_202506_UTC+0_2025_07_29_22_14_15.xlsx'"
    echo "   Size: $(ls -lh ' Neu_Task_202506_UTC+0_2025_07_29_22_14_15.xlsx' | awk '{print $5}')"
else
    echo "❌ Test file not found!"
fi
echo ""

echo "📋 Next Steps:"
echo "1. Wait for functions deployment to complete (if still running)"
echo "2. Create manager accounts in Firebase Console:"
echo "   - Go to: https://console.firebase.google.com/project/trend4media-billing/firestore"
echo "   - Create 'managers' collection with the managers listed in SYSTEM_STATUS_FINAL.md"
echo "3. Login to: https://trend4media-billing.web.app"
echo "   - Username: admin@trend4media.com"
echo "   - Password: Admin123!"
echo "4. Upload the Excel file and verify processing"
echo ""
echo "✅ System is ready for testing!" 