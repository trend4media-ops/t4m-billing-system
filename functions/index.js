const admin = require("firebase-admin");

// Initialize Firebase Admin SDK ONLY if it's not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}

// Load all compiled functions from the 'dist' directory
const compiledFunctions = require("./dist/index");
Object.assign(exports, compiledFunctions); 