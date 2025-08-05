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
        
        // Add a summary object
        const summary = {
            totalGross: 0,
            totalCommissions: 0,
            totalBonuses: 0,
            totalDownlineIncome: 0,
            totalEarnings: 0,
            activeManagers: 0,
            totalCreators: 0,
        };

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

            summary.activeManagers++;
            
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
            
            bonusesSnapshot.forEach(bonusDoc => {
                const bonus = bonusDoc.data();
                const amount = bonus.amount || 0;
                
                switch (bonus.type) {
                    case "MILESTONE_S":
                        bonusBreakdown.milestoneBonuses.S += amount;
                        break;
                    case "MILESTONE_N":
                        bonusBreakdown.milestoneBonuses.N += amount;
                        break;
                    case "MILESTONE_O":
                        bonusBreakdown.milestoneBonuses.O += amount;
                        break;
                    case "MILESTONE_P":
                        bonusBreakdown.milestoneBonuses.P += amount;
                        break;
                    case "GRADUATION_BONUS":
                        bonusBreakdown.graduationBonus += amount;
                        break;
                    case "DIAMOND_BONUS":
                        bonusBreakdown.diamondBonus += amount;
                        break;
                    case "RECRUITMENT_BONUS":
                        bonusBreakdown.recruitmentBonus += amount;
                        break;
                    case "DOWNLINE_LEVEL_A":
                        bonusBreakdown.downlineIncome.levelA += amount;
                        break;
                    case "DOWNLINE_LEVEL_B":
                        bonusBreakdown.downlineIncome.levelB += amount;
                        break;
                    case "DOWNLINE_LEVEL_C":
                        bonusBreakdown.downlineIncome.levelC += amount;
                        break;
                }
            });

            const managerTotalBonuses = 
                Object.values(bonusBreakdown.milestoneBonuses).reduce((a: number, b: number) => a + b, 0) +
                bonusBreakdown.graduationBonus +
                bonusBreakdown.diamondBonus +
                bonusBreakdown.recruitmentBonus;

            const managerTotalDownline = Object.values(bonusBreakdown.downlineIncome).reduce((a: number, b: number) => a + b, 0);

            // Update summary
            summary.totalGross += earningsData.totalGross || 0;
            summary.totalCommissions += earningsData.baseCommission || 0;
            summary.totalBonuses += managerTotalBonuses;
            summary.totalDownlineIncome += managerTotalDownline;
            summary.totalEarnings += earningsData.totalEarnings || 0;
            summary.totalCreators += earningsData.creatorCount || 0;
            
            earningsByManager.push({
                managerId: managerId,
                managerHandle: manager.name || manager.email,
                managerName: manager.name || manager.handle,
                managerType: manager.type || 'UNKNOWN',
                month: month,
                baseCommission: earningsData.baseCommission || 0,
                commissionTotal: earningsData.baseCommission || 0,
                ...bonusBreakdown,
                bonusTotal: managerTotalBonuses,
                downlineTotal: managerTotalDownline,
                totalEarnings: earningsData.totalEarnings || 0,
                totalGross: earningsData.totalGross || 0,
                totalDeductions: earningsData.totalDeductions || 0,
                totalNet: earningsData.totalNet || 0,
                transactionCount: earningsData.transactionCount || 0,
                creatorCount: earningsData.creatorCount || 0,
                type: manager.type || 'UNKNOWN',
                bonusCount: bonusesSnapshot.size,
                status: earningsData.status || 'CALCULATED',
                downlineIncome: bonusBreakdown.downlineIncome
            });
        }

        res.status(200).json({
            summary,
            managers: earningsByManager,
            cached: false,
            loadTime: 0
        });
    } catch (error) {
        console.error("💥 Error fetching all manager earnings:", error);
        res.status(500).json({ error: "Failed to fetch all manager earnings." });
    }
}; 