import * as admin from "firebase-admin";
import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth";

// For simplicity we use a fixed admin UID for manager->admin messages
const ADMIN_UID = 'admin-user-001';

export async function createMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { recipientId, content, title, module } = req.body as {
      recipientId?: string;
      content?: string;
      title?: string;
      module?: string;
    };

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const role = String(req.user.role || '').toUpperCase();
    const db = admin.firestore();

    // Determine and validate recipient
    let targetUserId: string | null = null;

    if (role === 'ADMIN') {
      // Admin can send to managers only; expect recipientId to be a managerId
      if (!recipientId) {
        res.status(400).json({ error: "recipientId (managerId) is required for admin" });
        return;
      }
      // Optionally verify the manager exists
      const mgrDoc = await db.collection('managers').doc(recipientId).get();
      if (!mgrDoc.exists) {
        res.status(404).json({ error: "Manager not found" });
        return;
      }
      targetUserId = recipientId; // store managerId in userId field
    } else if (role === 'MANAGER') {
      // Managers can only send to admin
      if (recipientId && recipientId !== ADMIN_UID) {
        res.status(403).json({ error: "Managers can only contact admin" });
        return;
      }
      targetUserId = ADMIN_UID;
    } else {
      res.status(403).json({ error: "Only ADMIN or MANAGER can send messages" });
      return;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const messageDoc = {
      userId: targetUserId,
      title: title || (role === 'ADMIN' ? 'Nachricht vom Admin' : 'Nachricht vom Manager'),
      content: content.trim(),
      module: module || 'DIRECT',
      read: false,
      isRead: false,
      createdAt: now,
      senderId: req.user.uid,
      senderRole: role,
    };

    const ref = await db.collection('messages').add(messageDoc);

    res.status(201).json({ id: ref.id, ...messageDoc });
  } catch (error) {
    console.error("Error creating message:", error);
    res.status(500).json({ error: "Failed to create message" });
  }
} 