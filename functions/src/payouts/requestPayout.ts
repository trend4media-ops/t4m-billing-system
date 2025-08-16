import { Response } from "express";
import * as admin from "firebase-admin";
import { AuthenticatedRequest } from "../middleware/auth";

interface PayoutRequestBody {
	period: string;
	requestedAmount?: number;
	amount?: number;
	bankDetails?: string;
	notes?: string;
}

export async function requestPayout(
	req: AuthenticatedRequest,
	res: Response
): Promise<void> {
	try {
		if (!req.user || (String(req.user.role).toUpperCase() !== "MANAGER")) {
			res.status(403).json({ error: "Access denied. Manager role required." });
			return;
		}
		
		const { managerId, uid, email, firstName, lastName } = req.user;
		if (!managerId) {
			res.status(400).json({ error: "Manager ID is missing from user token." });
			return;
		}

		const { period, requestedAmount, amount, bankDetails, notes } = req.body as PayoutRequestBody;

		if (!period) {
			res.status(400).json({ error: "Missing required field: period" });
			return;
		}

		// Require PDF invoice upload
		const file = (req as any).file as Express.Multer.File | undefined;
		if (!file) {
			res.status(400).json({ error: "Eine Rechnung (PDF) ist verpflichtend hochzuladen." });
			return;
		}
		const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
		if (!isPdf) {
			res.status(400).json({ error: "Nur PDF-Dokumente werden akzeptiert." });
			return;
		}

		const raw = typeof amount === 'number' ? amount : requestedAmount;
		const requested = raw ? Math.round(raw * 100) / 100 : 0;
		if (!requested || requested <= 0) {
			res.status(400).json({ error: "Requested amount must be a positive number." });
			return;
		}

		const db = admin.firestore();

		// NEW: Ensure manager acknowledged SETTINGS_APPLY notice for this period if present
		try {
			const ackSnap = await db.collection('messages')
				.where('userId', '==', managerId)
				.where('module', '==', 'SETTINGS_APPLY')
				.where('requiresAck', '==', true)
				.orderBy('createdAt', 'desc')
				.limit(1)
				.get();
			if (!ackSnap.empty) {
				const msg = ackSnap.docs[0].data() as any;
				const msgText: string = String(msg.content || '');
				const mentionsPeriod = msgText.includes(period.slice(0,4)) && msgText.includes(period.slice(4));
				const isRead = Boolean(msg.isRead || msg.read);
				if (mentionsPeriod && !isRead) {
					res.status(400).json({ error: "Bitte bestätigen Sie die Benachrichtigung zur Provisionsänderung für diesen Monat im Message Center, bevor eine Auszahlung angefragt werden kann." });
					return;
				}
			}
		} catch {}

		// 1) Load base + bonuses dynamically for the month
		const earningsDoc = await db.collection("manager-earnings").doc(`${managerId}_${period}`).get();
		const baseCommission = earningsDoc.exists ? (earningsDoc.data()?.baseCommission || 0) : 0;
		const bonusesSnap = await db.collection('bonuses')
			.where('managerId', '==', managerId)
			.where('month', '==', period)
			.get();
		const bonusesSum = bonusesSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);

		// Manual adjustments for the month
		const adjustmentsSnap = await db.collection('manualAdjustments')
			.where('managerId','==', managerId)
			.where('month','==', period)
			.get();
		const manualAdjustmentsTotal = adjustmentsSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);

		const totalEarnings = Math.round((baseCommission + bonusesSum + manualAdjustmentsTotal) * 100) / 100;

		// 2) Sum already requested for the month (open + approved + paid)
		const existingRequestsSnapshot = await db
			.collection("payoutRequests")
			.where("managerId", "==", managerId)
			.where("period", "==", period)
			.get();

		const alreadyRequested = existingRequestsSnapshot.docs
			.map(d => d.data())
			.filter(d => (d.status || 'SUBMITTED') !== 'REJECTED')
			.reduce((sum, d:any) => sum + (d.amount || d.requestedAmount || 0), 0);

		const netAvailable = Math.max(0, totalEarnings - alreadyRequested);

		// Enforce minimum available threshold of 150 EUR for allowing requests
		if (netAvailable < 150) {
			res.status(400).json({ 
				error: "Mindestauszahlungsbetrag ist 150€ (verfügbarer Betrag zu gering).",
				netAvailable,
				requiredMinimum: 150
			});
			return;
		}

		if (requested > netAvailable) {
			res.status(400).json({ 
				error: "Requested amount exceeds available balance.",
				totalEarnings,
				alreadyRequested,
				netAvailable,
				requested
			});
			return;
		}

		// 3) Upload invoice PDF to Cloud Storage
		const bucket = admin.storage().bucket();
		const safeName = (file.originalname || 'invoice.pdf').replace(/[^a-zA-Z0-9_.-]/g, '_');
		const destPath = `invoices/${managerId}/${period}/${Date.now()}_${safeName}`;
		const fileRef = bucket.file(destPath);
		await fileRef.save(file.buffer, { contentType: 'application/pdf', resumable: false, public: false, metadata: { cacheControl: 'no-store' } });
		const [signedUrl] = await fileRef.getSignedUrl({ action: 'read', expires: Date.now() + 1000 * 60 * 60 * 24 * 30 }); // 30 Tage URL

		// 4) Create payout request in payoutRequests collection
		const ref = db.collection("payoutRequests").doc();
		const newPayoutRequest = {
			id: ref.id,
			managerId,
			managerName: `${firstName || ''} ${lastName || ''}`.trim() || email || managerId,
			userId: uid,
			period,
			amount: requested,
			availableOnRequest: totalEarnings,
			status: "SUBMITTED",
			bankDetails: bankDetails || "",
			notes: notes || "",
			// Currency metadata for clarity
			currency: 'EUR',
			amountEUR: requested,
			fxRateOnRequest: null,
			requestedAt: admin.firestore.FieldValue.serverTimestamp(),
			history: [
				{
					status: "SUBMITTED",
					timestamp: admin.firestore.Timestamp.now(),
					actor: "MANAGER",
					userId: uid,
				}
			],
			invoice: {
				storagePath: destPath,
				fileName: file.originalname || 'invoice.pdf',
				contentType: 'application/pdf',
				size: file.size || null,
				signedUrl: signedUrl
			}
		} as any;

		await ref.set(newPayoutRequest);

		res.status(201).json({ success: true, request: newPayoutRequest });
		
	} catch (error:any) {
		console.error("💥 Error in requestPayout:", error);
		if (String(error?.message || '').includes('ONLY_PDF_ALLOWED')) {
			res.status(400).json({ error: "Nur PDF-Dokumente werden akzeptiert." });
			return;
		}
		res.status(500).json({ error: "Failed to create payout request due to an internal server error." });
	}
} 