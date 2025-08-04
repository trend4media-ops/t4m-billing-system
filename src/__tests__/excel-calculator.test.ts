import { processCommissionData } from '../excel-calculator';
import * as admin from 'firebase-admin';

// Mocking Firebase Admin SDK
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  firestore: jest.fn(() => ({
    collection: jest.fn((name: string) => ({
      doc: jest.fn(() => ({
        id: `mock-${name}-doc-id`,
        collection: jest.fn().mockReturnThis(), // For sub-collections like 'errors'
      })),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn(() => Promise.resolve({
        empty: false,
        docs: [
          {
            id: 'mock-manager-id',
            data: () => ({ name: 'Test Manager 1' }),
          }
        ]
      })),
    })),
    batch: jest.fn(() => ({
      set: jest.fn(),
      commit: jest.fn(() => Promise.resolve()),
    })),
  })),
}));

describe('Commission Calculation Logic (processCommissionData)', () => {

  let mockBatch: { set: jest.Mock, commit: jest.Mock };
  let mockFirestore: { collection: jest.Mock, batch: jest.Mock };

  beforeEach(() => {
    mockBatch = {
      set: jest.fn(),
      commit: jest.fn(() => Promise.resolve()),
    };
    mockFirestore = {
      collection: jest.fn().mockReturnThis(),
      batch: jest.fn(() => mockBatch),
    };
    (admin.firestore as jest.Mock).mockReturnValue(mockFirestore);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Test Case 1: Live Manager - Full Milestones', async () => {
    const rows = [
      ['Header1', 'Header2', 'Header3', 'Header4', 'Header5', 'Header6', 'Header7', 'Header8', 'Header9', 'Header10', 'Header11', 'Header12', 'Header13', 'Header14', 'Header15', 'Header16', 'Header17', 'Header18', 'Header19'],
      ['Test Manager 1', 'live', null, null, null, null, null, null, null, null, null, null, '2000', 'X', 'X', 'X', null, null, 'X']
    ];
    const batchId = 'test-batch-1';
    const month = '202506';

    await processCommissionData(rows, batchId, month);

    // Verify correct number of bonus/transaction documents are created
    // Expecting 1 transaction + 1 base commission + 4 milestone bonuses = 6 documents
    expect(mockBatch.set).toHaveBeenCalledTimes(6);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);

    const createdDocs = mockBatch.set.mock.calls.map(call => call[1]);

    // 1. Check Transaction Document
    const transactionDoc = createdDocs.find(doc => doc.netForCommission !== undefined);
    expect(transactionDoc.grossAmount).toBe(2000);
    expect(transactionDoc.deductions).toBe(1690); // 300(N) + 1000(O) + 240(P) + 150(S)
    expect(transactionDoc.netForCommission).toBe(310);
    expect(transactionDoc.baseCommission).toBe(93); // 30% of 310

    // 2. Check Bonus Documents
    const baseCommissionBonus = createdDocs.find(doc => doc.type === 'BASE_COMMISSION');
    expect(baseCommissionBonus.amount).toBe(93);

    const milestoneS_Bonus = createdDocs.find(doc => doc.type === 'MILESTONE_S');
    expect(milestoneS_Bonus.amount).toBe(75); // Live Manager payout

    const milestoneN_Bonus = createdDocs.find(doc => doc.type === 'MILESTONE_N');
    expect(milestoneN_Bonus.amount).toBe(150); // Live Manager payout

    const milestoneO_Bonus = createdDocs.find(doc => doc.type === 'MILESTONE_O');
    expect(milestoneO_Bonus.amount).toBe(400); // Live Manager payout

    const milestoneP_Bonus = createdDocs.find(doc => doc.type === 'MILESTONE_P');
    expect(milestoneP_Bonus.amount).toBe(100); // Live Manager payout
  });

}); 