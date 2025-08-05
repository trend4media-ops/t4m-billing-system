import * as admin from 'firebase-admin';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';

const db = admin.firestore();

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

        const genealogyData = {
            ...req.body,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('genealogy').add(genealogyData);
        
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
        const updateData = {
            ...req.body,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

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