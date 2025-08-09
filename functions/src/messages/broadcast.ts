import * as admin from "firebase-admin";
import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth";

export async function broadcastMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user || String(req.user.role || '').toUpperCase() !== 'ADMIN') {
      res.status(403).json({ error: 'Admin role required' });
      return;
    }

    const { managerIds, content, title, module } = req.body as {
      managerIds?: string[];
      content?: string;
      title?: string;
      module?: string;
    };

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const db = admin.firestore();

    // Determine recipients: provided list or all managers
    let recipients: string[] = [];
    if (Array.isArray(managerIds) && managerIds.length > 0) {
      recipients = managerIds;
    } else {
      const snap = await db.collection('managers').get();
      recipients = snap.docs.map(d => d.id);
    }

    if (recipients.length === 0) {
      res.status(400).json({ error: 'No recipients found' });
      return;
    }

    const broadcastId = db.collection('messages').doc().id;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const batch = db.batch();
    recipients.forEach((mgrId) => {
      const ref = db.collection('messages').doc();
      batch.set(ref, {
        userId: mgrId, // managerId as recipient key
        title: title || 'Broadcast vom Admin',
        content: content.trim(),
        module: module || 'BROADCAST',
        read: false,
        isRead: false,
        createdAt: now,
        senderId: req.user!.uid,
        senderRole: 'ADMIN',
        isBroadcast: true,
        broadcastId,
      });
    });

    // Optionally store broadcast meta
    const metaRef = db.collection('broadcasts').doc(broadcastId);
    batch.set(metaRef, {
      id: broadcastId,
      senderId: req.user!.uid,
      title: title || 'Broadcast',
      content: content.trim(),
      module: module || 'BROADCAST',
      totalRecipients: recipients.length,
      createdAt: now,
    });

    await batch.commit();

    res.status(201).json({ broadcastId, totalRecipients: recipients.length });
  } catch (error) {
    console.error('Error broadcasting message:', error);
    res.status(500).json({ error: 'Failed to broadcast message' });
  }
}

export async function getBroadcastStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user || String(req.user.role || '').toUpperCase() !== 'ADMIN') {
      res.status(403).json({ error: 'Admin role required' });
      return;
    }

    const { broadcastId } = req.params as { broadcastId: string };
    if (!broadcastId) {
      res.status(400).json({ error: 'broadcastId required' });
      return;
    }

    const db = admin.firestore();
    const qs = await db.collection('messages').where('broadcastId', '==', broadcastId).get();
    const items = qs.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

    const total = items.length;
    const readItems = items.filter(i => i.isRead === true || i.read === true);
    const readCount = readItems.length;

    res.status(200).json({
      broadcastId,
      total,
      readCount,
      unreadCount: total - readCount,
      recipients: items.map(i => ({ userId: i.userId, isRead: Boolean(i.isRead || i.read), readAt: i.readAt || null })),
    });
  } catch (error) {
    console.error('Error getting broadcast status:', error);
    res.status(500).json({ error: 'Failed to get broadcast status' });
  }
} 