# Excel Format Mapping - T4M Billing System

## Actual Excel Format (from  Neu_Task_202506_UTC+0_2025_07_29_22_14_15.xlsx)

### Column Mapping
- **Column A (0)**: Data Month (e.g., "202506")
- **Column B (1)**: Creator ID
- **Column C (2)**: Creator nickname
- **Column D (3)**: Handle
- **Column E (4)**: Creator Network manager (LIVE Manager Name)
- **Column F (5)**: Group
- **Column G (6)**: Group manager (TEAM Manager Name)
- **Column H (7)**: Is violative creators
- **Column I (8)**: The creator was Rookie at the time of first joining
- **Column J (9)**: Diamonds
- **Column K (10)**: Valid days(d)
- **Column L (11)**: LIVE duration(h)
- **Column M (12)**: Estimated bonus (Gross Amount in €)
- **Column N (13)**: Estimated bonus - Rookie half-milestone bonus task (was S)
- **Column O (14)**: Estimated bonus - Rookie milestone 1 bonus task (was N)
- **Column P (15)**: Estimated bonus - Rookie milestone 1 retention bonus task (unchanged)
- **Column Q (16)**: Estimated bonus - Rookie milestone 2 bonus task (was O)
- **Column R (17)**: Estimated bonus - Activeness task task
- **Column S (18)**: (no longer used for milestones in new format)

## Key Points for Processing:
1. **Manager Identification**: 
   - LIVE Managers are in Column E (index 4)
   - TEAM Managers are in Column G (index 6)
   - One of these will be empty, the other contains the manager name

2. **Manager Type Detection**:
   - If Column E has a value → Type is "live"
   - If Column G has a value → Type is "team"

3. **Gross Amount**: Column M (index 12) - "Estimated bonus"

4. **Milestone Bonuses**:
   - Milestone N: Column N (index 13)
   - Milestone O: Column O (index 14)
   - Milestone P: Column P (index 15)
   - Milestone S: Column S (index 18)

## Example Row Processing:
```javascript
const managerName = row[4] || row[6]; // Live or Team manager
const managerType = row[4] ? 'live' : 'team';
const grossAmount = parseFloat(row[12]);
const milestones = {
  S: row[13], // moved from 18
  N: row[14], // moved from 13
  O: row[16], // moved from 14
  P: row[15]  // unchanged
};
``` 