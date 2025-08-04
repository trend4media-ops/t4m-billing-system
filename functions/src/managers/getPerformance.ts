import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import * as admin from 'firebase-admin';

const db = admin.firestore();

interface PerformanceMetrics {
  currentMonthRank: number;
  totalManagers: number;
  growthPercentage: number;
  avgMonthlyEarnings: number;
  bestMonth: {
    period: string;
    earnings: number;
  };
  achievementBadges: string[];
  last6Months: Array<{
    period: string;
    earnings: number;
  }>;
}

export async function getManagerPerformance(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { managerId } = req.params;
    
    // Verify authorization
    if (req.user?.role !== 'admin' && req.user?.managerId !== managerId) {
      res.status(403).json({ error: 'Unauthorized access' });
      return;
    }

    // Get current month
    const currentMonth = new Date().toISOString().slice(0, 7).replace('-', '');
    
    // Get earnings for last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const months = [];
    for (let i = 0; i < 6; i++) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      months.push(date.toISOString().slice(0, 7).replace('-', ''));
    }
    
    // Fetch earnings data
    const earningsPromises = months.map(async (month) => {
      const bonusesSnapshot = await db.collection('bonuses')
        .where('managerId', '==', managerId)
        .where('month', '==', month)
        .get();
        
      let total = 0;
      bonusesSnapshot.forEach(doc => {
        total += doc.data().amount || 0;
      });
      
      return { period: month, earnings: total };
    });
    
    const last6Months = await Promise.all(earningsPromises);
    last6Months.reverse(); // Oldest to newest
    
    // Calculate growth percentage (current vs previous month)
    const currentMonthEarnings = last6Months[last6Months.length - 1]?.earnings || 0;
    const previousMonthEarnings = last6Months[last6Months.length - 2]?.earnings || 0;
    const growthPercentage = previousMonthEarnings > 0 
      ? ((currentMonthEarnings - previousMonthEarnings) / previousMonthEarnings) * 100 
      : 0;
    
    // Calculate average monthly earnings
    const totalEarnings = last6Months.reduce((sum, month) => sum + month.earnings, 0);
    const avgMonthlyEarnings = totalEarnings / last6Months.length;
    
    // Find best month
    const bestMonth = last6Months.reduce((best, current) => 
      current.earnings > best.earnings ? current : best
    , { period: '', earnings: 0 });
    
    // Calculate rank for current month
    const allManagersSnapshot = await db.collection('bonuses')
      .where('month', '==', currentMonth)
      .get();
      
    const managerEarnings = new Map<string, number>();
    allManagersSnapshot.forEach(doc => {
      const data = doc.data();
      const current = managerEarnings.get(data.managerId) || 0;
      managerEarnings.set(data.managerId, current + data.amount);
    });
    
    const sortedManagers = Array.from(managerEarnings.entries())
      .sort((a, b) => b[1] - a[1]);
      
    const currentMonthRank = sortedManagers.findIndex(([id]) => id === managerId) + 1;
    const totalManagers = sortedManagers.length;
    
    // Determine achievement badges
    const achievementBadges = [];
    if (growthPercentage >= 20) achievementBadges.push('High Growth');
    if (currentMonthRank <= 10) achievementBadges.push('Top 10');
    if (currentMonthRank === 1) achievementBadges.push('Champion');
    if (avgMonthlyEarnings >= 10000) achievementBadges.push('High Earner');
    if (last6Months.every(m => m.earnings > 0)) achievementBadges.push('Consistent');
    
    const metrics: PerformanceMetrics = {
      currentMonthRank,
      totalManagers,
      growthPercentage,
      avgMonthlyEarnings,
      bestMonth,
      achievementBadges,
      last6Months
    };
    
    res.json({
      success: true,
      data: metrics
    });
    
  } catch (error) {
    console.error('Error fetching performance metrics:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch performance metrics' 
    });
  }
} 