import * as admin from "firebase-admin";
import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth";

export const getUnreadMessagesCount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!req.user) {
        res.status(403).json({ error: "Authentication required." });
        return;
    }

    const { uid } = req.user;

    try {
        const db = admin.firestore();
        const unreadMessagesSnapshot = await db.collection("messages")
            .where("userId", "==", uid)
            .where("read", "==", false)
            .get();
        
        res.status(200).json({ count: unreadMessagesSnapshot.size });
    } catch (error) {
        console.error("💥 Error fetching unread messages count:", error);
        res.status(500).json({ error: "Failed to fetch unread messages count." });
    }
}; 