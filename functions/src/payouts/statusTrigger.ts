import * as admin from "firebase-admin";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

export const onPayoutStatusChange = onDocumentUpdated(
  { region: "europe-west1", document: "payoutRequests/{requestId}" },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();
    
    if (!beforeData || !afterData) return;

    const db = admin.firestore();
    
    // Check if status changed
    if (beforeData.status !== afterData.status) {
      // Create audit log
      await db.collection("auditLogs").add({
        userId: afterData.decidedBy || "system",
        action: `payout_status_changed`,
        targetCollection: "payoutRequests",
        targetId: event.params.requestId,
        before: { status: beforeData.status },
        after: { status: afterData.status },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        metadata: {
          managerId: afterData.managerId,
          period: afterData.period,
          amount: afterData.amount
        }
      });

      // Create notification message for manager
      if (afterData.status === "APPROVED" || afterData.status === "DENIED") {
        await db.collection("messages").add({
          userId: afterData.managerId,
          title: `Payout Request ${afterData.status}`,
          body: `Your payout request for ${afterData.period} (€${afterData.amount}) has been ${afterData.status.toLowerCase()}.`,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          type: "payout_update"
        });
      }
    }
  }
); 