import * as admin from "firebase-admin";
import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth";

export const getAllManagerEarnings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ error: "Access Denied: Admin role required." });
        return;
    }

    const month = req.query.month as string;
    if (!month || !/^\d{6}$/.test(month)) {
        res.status(400).json({ error: "Invalid or missing month parameter. Expected format YYYYMM." });
        return;
    }

    try {
        const db = admin.firestore();
        
        // Get manager earnings for the month
        const earningsSnapshot = await db.collection("manager-earnings")
            .where("month", "==", month)
            .get();
        
        const earningsByManager: any[] = [];
        
        // Get managers collection to get manager details
        const managersSnapshot = await db.collection("managers").get();
        const managersMap = new Map<string, any>();
        managersSnapshot.forEach(doc => {
            managersMap.set(doc.id, doc.data());
        });
        
        // Process earnings and get bonus breakdown
        for (const earningsDoc of earningsSnapshot.docs) {
            const earningsData = earningsDoc.data();
            const managerId = earningsData.managerId;
            const manager = managersMap.get(managerId);
            
            if (!manager) continue;
            
            // Get bonus breakdown for this manager and month
            const bonusesSnapshot = await db.collection("bonuses")
                .where("managerId", "==", managerId)
                .where("month", "==", month)
                .get();
            
            const bonusBreakdown = {
                milestoneBonuses: { S: 0, N: 0, O: 0, P: 0 },
                graduationBonus: 0,
                diamondBonus: 0,
                recruitmentBonus: 0,
                downlineIncome: { levelA: 0, levelB: 0, levelC: 0 },
            };
            
            bonusesSnapshot.forEach(doc => {
                const bonus = doc.data();
                switch (bonus.type) {
                    case "MILESTONE_S":
                        bonusBreakdown.milestoneBonuses.S += bonus.amount;
                        break;
                    case "MILESTONE_N":
                        bonusBreakdown.milestoneBonuses.N += bonus.amount;
                        break;
                    case "MILESTONE_O":
                        bonusBreakdown.milestoneBonuses.O += bonus.amount;
                        break;
                    case "MILESTONE_P":
                        bonusBreakdown.milestoneBonuses.P += bonus.amount;
                        break;
                    case "GRADUATION_BONUS":
                        bonusBreakdown.graduationBonus += bonus.amount;
                        break;
                    case "DIAMOND_BONUS":
                        bonusBreakdown.diamondBonus += bonus.amount;
                        break;
                    case "RECRUITMENT_BONUS":
                        bonusBreakdown.recruitmentBonus += bonus.amount;
                        break;
                    case "DOWNLINE_LEVEL_A":
                        bonusBreakdown.downlineIncome.levelA += bonus.amount;
                        break;
                    case "DOWNLINE_LEVEL_B":
                        bonusBreakdown.downlineIncome.levelB += bonus.amount;
                        break;
                    case "DOWNLINE_LEVEL_C":
                        bonusBreakdown.downlineIncome.levelC += bonus.amount;
                        break;
                }
            });
            
            earningsByManager.push({
                managerId: managerId,
                managerHandle: manager.name || manager.email,
                month: month,
                baseCommission: earningsData.baseCommission || 0,
                ...bonusBreakdown,
                totalEarnings: earningsData.totalEarnings || 0,
                totalGross: earningsData.totalGross || 0,
                totalDeductions: earningsData.totalDeductions || 0,
                totalNet: earningsData.totalNet || 0,
                transactionCount: earningsData.transactionCount || 0,
                status: earningsData.status || 'CALCULATED'
            });
        }

        res.status(200).json(earningsByManager);
    } catch (error) {
        console.error("💥 Error fetching all manager earnings:", error);
        res.status(500).json({ error: "Failed to fetch all manager earnings." });
    }
}; 