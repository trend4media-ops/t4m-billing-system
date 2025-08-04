import * as admin from "firebase-admin";
import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth";

export const getMessages = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!req.user) {
        res.status(403).json({ error: "Authentication required." });
        return;
    }
    
    const { uid } = req.user;
    const limit = parseInt(req.query.limit as string) || 20;

    try {
        const db = admin.firestore();
        const messagesSnapshot = await db.collection("messages")
            .where("userId", "==", uid)
            .orderBy("createdAt", "desc")
            .limit(limit)
            .get();
        
        const messages = messagesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(messages);
    } catch (error) {
        console.error("💥 Error fetching messages:", error);
        res.status(500).json({ error: "Failed to fetch messages." });
    }
}; 