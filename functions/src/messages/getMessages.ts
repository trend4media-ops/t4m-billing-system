import * as admin from "firebase-admin";
import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth";

export async function getMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const db = admin.firestore();
    const { userId } = req.params;

    // If userId is provided in params, use it (for specific user messages)
    // Otherwise use the authenticated user's UID
    const targetUserId = userId || req.user.uid;

    // Access control: users can only access their own messages, admins can access any
    if (req.user.role !== 'ADMIN' && req.user.uid !== targetUserId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const messagesSnapshot = await db
      .collection("messages")
      .where("userId", "==", targetUserId)
      .orderBy("createdAt", "desc")
      .get();

    const messages = messagesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
}

export async function markMessageAsRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { messageId } = req.params;
    const db = admin.firestore();

    // Get the message to check ownership
    const messageDoc = await db.collection("messages").doc(messageId).get();
    
    if (!messageDoc.exists) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const messageData = messageDoc.data();
    
    // Access control: users can only mark their own messages as read, admins can mark any
    if (req.user.role !== 'ADMIN' && req.user.id !== messageData?.userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Update the message to mark as read
    await db.collection("messages").doc(messageId).update({
      read: true,
      readAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, message: "Message marked as read" });
  } catch (error) {
    console.error("Error marking message as read:", error);
    res.status(500).json({ error: "Failed to mark message as read" });
  }
} 