import * as admin from "firebase-admin";
import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth";

/**
 * Fetches all managers from the Firestore database.
 * @param {AuthenticatedRequest} req The authenticated request object.
 * @param {Response} res The response object.
 * @returns {Promise<void>} A promise that resolves when the managers are fetched.
 */
export const getManagers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ error: "Access Denied: Admin role required." });
        return;
    }

    try {
        const db = admin.firestore();
        const snapshot = await db.collection("managers").get();
        const managers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(managers);
    } catch (error) {
        console.error("💥 Error fetching managers:", error);
        res.status(500).json({ error: "Failed to fetch managers." });
    }
}; 