import * as admin from 'firebase-admin';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { CommissionConfigService } from '../services/commissionConfig';

const db = admin.firestore();

function normalizeHandle(value?: string | null): string {
  if (!value) return '';
  return String(value).trim().toLowerCase().replace(/^@/, '');
}

export const getDownlineCompensation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.role !== 'ADMIN') {
      res.status(403).json({ error: 'Admin role required' });
      return;
    }

    async function resolvePeriod(input?: string): Promise<string> {
      const p = (input || '').trim();
      if (/^\d{6}$/.test(p)) return p;
      // 1) Prefer active upload batch
      try {
        const activeSnap = await db.collection('uploadBatches')
          .where('active', '==', true)
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
        if (!activeSnap.empty) {
          const m = (activeSnap.docs[0].data().month as string) || '';
          if (/^\d{6}$/.test(m)) return m;
        }
      } catch {}
      // 2) Latest processed month from manager-earnings
      try {
        const earningsSnap = await db.collection('manager-earnings')
          .orderBy('month', 'desc')
          .limit(1)
          .get();
        if (!earningsSnap.empty) {
          const m = (earningsSnap.docs[0].data().month as string) || '';
          if (/^\d{6}$/.test(m)) return m;
        }
      } catch {}
      // 3) Fallback to current calendar month
      const now = new Date();
      const fallback = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      return fallback;
    }

    const period = await resolvePeriod(req.query.period as string | undefined);

    // Load all assignments
    const genealogySnap = await db.collection('genealogy').get();
    if (genealogySnap.empty) {
      res.status(200).json({ success: true, data: [], period });
      return;
    }

    const results: any[] = [];

    for (const doc of genealogySnap.docs) {
      const g = doc.data() as any;
      const teamManagerId: string | undefined = g.teamManagerId;
      const liveManagerId: string | undefined = g.liveManagerId;
      const level: 'A'|'B'|'C' = (String(g.level || 'A').toUpperCase() as any);
      if (!teamManagerId || !liveManagerId) continue;
      if (teamManagerId === liveManagerId) continue; // ignore self-links

      // Sum child's BASE COMMISSION for the month
      const txSnap = await db.collection('transactions')
        .where('managerId', '==', liveManagerId)
        .where('month', '==', period)
        .get();
      let childBase = 0;
      txSnap.forEach(t => { childBase += (t.data().baseCommission || 0); });

      const cfg = await CommissionConfigService.getInstance().getConfigForPeriod(period);
      const downRates = cfg.downlineRates || { A: 0.10, B: 0.075, C: 0.05 };
      const rate = (downRates as any)[level] ?? (level === 'A' ? 0.10 : level === 'B' ? 0.075 : 0.05);
      const computed = (childBase || 0) * rate;

      // Booked (accrued) downline bonuses for THIS child and level
      const bookedSnap = await db.collection('bonuses')
        .where('managerId', '==', teamManagerId)
        .where('month', '==', period)
        .where('type', '==', `DOWNLINE_LEVEL_${level}`)
        .where('relatedManagerId', '==', liveManagerId)
        .get();
      let booked = 0;
      bookedSnap.forEach(b => { booked += (b.data().amount || 0); });

      results.push({
        id: doc.id,
        period,
        level,
        rate,
        teamManagerId,
        liveManagerId,
        teamManagerHandle: g.teamManagerHandle || teamManagerId,
        liveManagerHandle: g.liveManagerHandle || liveManagerId,
        childBaseCommission: Math.round((childBase || 0) * 100) / 100,
        computedCommission: Math.round(computed * 100) / 100,
        bookedCommission: Math.round(booked * 100) / 100,
        paidCommission: 0,
        delta: Math.round((computed - booked) * 100) / 100,
      });
    }

    res.status(200).json({ success: true, data: results, period });
  } catch (error) {
    console.error('💥 Error computing downline compensation:', error);
    res.status(500).json({ error: 'Failed to compute downline compensation' });
  }
};

async function resolveManager(refOrHandle?: string): Promise<{ id: string; data: FirebaseFirestore.DocumentData } | null> {
  if (!refOrHandle) return null;
  const val = String(refOrHandle).trim();
  try {
    const maybeDoc = await db.collection('managers').doc(val).get();
    if (maybeDoc.exists) return { id: maybeDoc.id, data: maybeDoc.data()! };
  } catch {}
  const byHandle = await db.collection('managers').where('handle', '==', val).limit(1).get();
  if (!byHandle.empty) { const d = byHandle.docs[0]; return { id: d.id, data: d.data() }; }
  const byName = await db.collection('managers').where('name', '==', val).limit(1).get();
  if (!byName.empty) { const d = byName.docs[0]; return { id: d.id, data: d.data() }; }
  const all = await db.collection('managers').get();
  const norm = normalizeHandle(val);
  for (const doc of all.docs) {
    const data = doc.data();
    if (normalizeHandle(data.handle) === norm || normalizeHandle(data.name) === norm) {
      return { id: doc.id, data };
    }
  }
  return null;
}

export const getAllGenealogy = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        // Check admin access
        if (req.user?.role !== 'ADMIN') {
            res.status(403).json({ error: "Admin role required" });
            return;
        }

        // Get all genealogy data
        const snapshot = await db.collection('genealogy').get();
        
        const genealogyData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        console.log(`📊 Retrieved ${genealogyData.length} genealogy records`);
        
        res.status(200).json({
            success: true,
            data: genealogyData,
            count: genealogyData.length
        });

    } catch (error) {
        console.error('💥 Error fetching genealogy data:', error);
        res.status(500).json({ 
            error: "Failed to fetch genealogy data",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
};

export const getGenealogyByTeamHandle = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { teamManagerHandle } = req.params;
        
        if (!teamManagerHandle) {
            res.status(400).json({ error: "Team manager handle is required" });
            return;
        }

        const snapshot = await db.collection('genealogy')
            .where('teamManagerHandle', '==', teamManagerHandle)
            .get();
        
        if (snapshot.empty) {
            res.status(404).json({ error: "No genealogy data found for this team manager" });
            return;
        }

        const genealogyData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.status(200).json({
            success: true,
            data: genealogyData,
            teamManagerHandle
        });

    } catch (error) {
        console.error('💥 Error fetching genealogy by team handle:', error);
        res.status(500).json({ 
            error: "Failed to fetch genealogy data",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
};

export const createGenealogy = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (req.user?.role !== 'ADMIN') {
            res.status(403).json({ error: "Admin role required" });
            return;
        }

        const { teamManagerHandle, teamManagerId, liveManagerHandle, liveManagerId, level } = req.body as any;
        if (!(teamManagerHandle || teamManagerId) || !(liveManagerHandle || liveManagerId) || !level) {
            res.status(400).json({ error: 'teamManager and liveManager and level are required' });
            return;
        }

        // Resolve managers
        const team = await resolveManager(teamManagerId || teamManagerHandle);
        const live = await resolveManager(liveManagerId || liveManagerHandle);
        if (!team || !live) {
            res.status(404).json({ error: 'Manager not found (team or live)' });
            return;
        }
        if (team.id === live.id) {
            res.status(400).json({ error: 'Team Manager and Live Manager must be different' });
            return;
        }

        // Promote team manager to TEAM if needed
        const teamType = String(team.data.type || '').toUpperCase();
        if (teamType !== 'TEAM') {
            await db.collection('managers').doc(team.id).update({ 
                type: 'TEAM',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        const payload = {
            teamManagerId: team.id,
            teamManagerHandle: team.data.handle || team.data.name || team.id,
            liveManagerId: live.id,
            liveManagerHandle: live.data.handle || live.data.name || live.id,
            level: String(level).toUpperCase() as 'A' | 'B' | 'C',
            assignedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        // Optional: prevent duplicates for the same pair
        const duplicateSnap = await db.collection('genealogy')
          .where('teamManagerId', '==', payload.teamManagerId)
          .where('liveManagerId', '==', payload.liveManagerId)
          .limit(1)
          .get();
        if (!duplicateSnap.empty) {
          // Update level instead of creating a second document
          await duplicateSnap.docs[0].ref.update({ level: payload.level, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          res.status(200).json({ success: true, id: duplicateSnap.docs[0].id, message: 'Genealogy record updated (existing pair)' });
          return;
        }

        const docRef = await db.collection('genealogy').add(payload);
        
        res.status(201).json({
            success: true,
            id: docRef.id,
            message: "Genealogy record created successfully"
        });

    } catch (error) {
        console.error('💥 Error creating genealogy:', error);
        res.status(500).json({ 
            error: "Failed to create genealogy record",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
};

export const updateGenealogy = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (req.user?.role !== 'ADMIN') {
            res.status(403).json({ error: "Admin role required" });
            return;
        }

        const { id } = req.params;
        const { teamManagerHandle, teamManagerId, liveManagerHandle, liveManagerId, level } = req.body as any;

        const updateData: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        
        // If handles/ids provided, resolve and set
        if (teamManagerHandle || teamManagerId) {
            const team = await resolveManager(teamManagerId || teamManagerHandle);
            if (!team) { res.status(404).json({ error: 'Team manager not found' }); return; }
            updateData.teamManagerId = team.id;
            updateData.teamManagerHandle = team.data.handle || team.data.name || team.id;
            // Promote to TEAM
            const teamType = String(team.data.type || '').toUpperCase();
            if (teamType !== 'TEAM') {
              await db.collection('managers').doc(team.id).update({ type: 'TEAM', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            }
        }
        if (liveManagerHandle || liveManagerId) {
            const live = await resolveManager(liveManagerId || liveManagerHandle);
            if (!live) { res.status(404).json({ error: 'Live manager not found' }); return; }
            updateData.liveManagerId = live.id;
            updateData.liveManagerHandle = live.data.handle || live.data.name || live.id;
        }
        if (level) {
            updateData.level = String(level).toUpperCase();
        }

        await db.collection('genealogy').doc(id).update(updateData);
        
        res.status(200).json({
            success: true,
            message: "Genealogy record updated successfully"
        });

    } catch (error) {
        console.error('💥 Error updating genealogy:', error);
        res.status(500).json({ 
            error: "Failed to update genealogy record",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
};

export const deleteGenealogy = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (req.user?.role !== 'ADMIN') {
            res.status(403).json({ error: "Admin role required" });
            return;
        }

        const { id } = req.params;
        await db.collection('genealogy').doc(id).delete();
        
        res.status(200).json({
            success: true,
            message: "Genealogy record deleted successfully"
        });

    } catch (error) {
        console.error('💥 Error deleting genealogy:', error);
        res.status(500).json({ 
            error: "Failed to delete genealogy record",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
};

export const getTeamByManagerId = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { teamManagerId } = req.params;
        
        if (!teamManagerId) {
            res.status(400).json({ error: "Team manager ID is required" });
            return;
        }

        const snapshot = await db.collection('genealogy')
            .where('teamManagerId', '==', teamManagerId)
            .get();
        
        if (snapshot.empty) {
            res.status(404).json({ error: "No team data found for this manager" });
            return;
        }

        const teamData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.status(200).json({
            success: true,
            data: teamData,
            teamManagerId
        });

    } catch (error) {
        console.error('💥 Error fetching team by manager ID:', error);
        res.status(500).json({ 
            error: "Failed to fetch team data",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
}; 