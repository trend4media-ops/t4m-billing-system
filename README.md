# Trend4Media Billing & Commission System

This repository contains the complete billing and commission calculation system for Trend4Media. The system is built on a modern, serverless architecture using Firebase and Next.js, designed for scalability, security, and maintainability.

---

## 🏛️ System Architecture

The project is a monorepo composed of two main components:

1.  **`/functions`**: The serverless backend running on **Firebase Cloud Functions**. It handles all business logic, including data processing, commission calculations, and secure API endpoints.
2.  **`/trend4media-frontend`**: The web application built with **Next.js** and **React**. It provides the user interface for both Admins and Managers.

### Data Flow

The core workflow of the system is as follows:

1.  **Login**: Admins and Managers log in securely via the frontend using Firebase Authentication.
2.  **Excel Upload**: An Admin uploads the monthly commission data as an `.xlsx` file via the Admin Panel.
3.  **Data Processing**: The uploaded file triggers the `excelCalculator` Cloud Function. This function:
    - Validates the data structure of the file.
    - Calculates commissions, deductions, and bonuses based on the definitive business logic.
    - Prevents duplicate uploads for the same month.
    - Saves all resulting transactions and bonuses atomically to the **Firestore** database.
4.  **Downline Calculation**: On the 1st of every month, the `calculateDownlineCommissions` scheduled function runs automatically, calculating and saving downline bonuses for Team Managers.
5.  **Payout Request**: Managers can view their aggregated earnings in their dashboard and submit a payout request.
6.  **Payout Management**: Admins can view, manage, and update the status of all payout requests in the Admin Panel.

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v20 or higher recommended)
- Firebase CLI (`npm install -g firebase-tools`)

### Setup & Deployment

1.  **Install Dependencies**:
    ```bash
    npm install
    cd functions && npm install
    cd ../trend4media-frontend && npm install
    ```

2.  **Local Development**:
    - To run the full suite of local emulators (Auth, Functions, Firestore, Hosting):
      ```bash
      firebase emulators:start
      ```

3.  **Deployment**:
    - The entire application (Functions & Frontend Hosting) is deployed to Firebase. A simple script handles all necessary build steps.
      ```bash
      bash deploy-firebase.sh
      ```

---

## 🔧 Core Components Deep Dive

- **`functions/` (Backend)**
  - `src/excel-calculator.ts`: Triggered by file uploads. Contains the main commission calculation logic. **This is the financial heart of the system.**
  - `src/downline-calculator.ts`: A scheduled function for monthly downline commission calculations.
  - `src/payouts/`: Handles the logic for payout requests and status updates.
  - `src/index.ts`: Defines the main API routes.

- **`trend4media-frontend/` (Frontend)**
  - `src/app/admin/`: Contains all pages for the Admin Panel (Upload, Reports, Payouts, etc.).
  - `src/app/dashboard/`: Contains the pages for the Manager Dashboard.
  - `src/contexts/AuthContext.tsx`: Manages the application's authentication state using the secure, client-side Firebase Auth SDK.
  - `src/lib/api.ts`: A helper library for making authenticated requests to the backend API.

This new, streamlined architecture ensures a clear separation of concerns, robust data integrity, and a secure, reliable user experience. 