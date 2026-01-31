# Payment System Testing Guide

## Quick Test Scenarios

### Scenario 1: User Recharge (Successful)

**Prerequisites**:
- User is registered and logged in
- User has GHC 0 balance

**Steps**:
1. Navigate to home.html
2. Click the **"Recharge"** button in action buttons section
3. In the recharge modal, fill:
   - Payment Method: `Mobile Money (MTN)`
   - Amount: `100`
   - Phone Number: `233501234567`
4. Click **"Proceed to Payment"**

**Expected Results**:
✅ Modal closes
✅ "Payment Details" modal appears
✅ Displays green success message
✅ Shows "PENDING_..." as payment number
✅ Displays "Amount: GHC 100.00"
✅ Displays "Payment Method: MTN Mobile Money"
✅ Shows "Status: Awaiting Payment"
✅ "Copy Payment Number" button is clickable
✅ Warning message about manual transfer visible

**Verify in Console**:
```javascript
// Check localStorage for payment
JSON.parse(localStorage.getItem('pendingPayments'))
// Should show array with payment object

// Check user's payment history
const user = JSON.parse(localStorage.getItem('currentUser'));
JSON.parse(localStorage.getItem('userPayments_' + user.userId))
// Should contain the new payment
```

---

### Scenario 2: Form Validation

**Test Case 2a: Amount Too Low**
1. Open recharge modal
2. Enter Amount: `5` (less than minimum)
3. Click "Proceed to Payment"
4. ❌ Should see alert: "Amount must be at least GHC 10"

**Test Case 2b: Invalid Phone**
1. Open recharge modal
2. Enter Phone: `123` (less than 10 digits)
3. Click "Proceed to Payment"
4. ❌ Should see alert: "Please enter a valid phone number"

**Test Case 2c: Missing Fields**
1. Open recharge modal
2. Leave Amount empty
3. Click "Proceed to Payment"
4. ❌ Should see alert: "Amount must be at least GHC 10"

---

### Scenario 3: Copy Payment Number

**Prerequisites**:
- User has completed recharge flow
- "Payment Details" modal is open
- Payment Number shows "PENDING_..." initially

**Steps**:
1. Look at payment number display area (large monospace font)
2. Click **"Copy Payment Number"** button
3. Open a text editor or note app
4. Paste the copied text (Ctrl+V or Cmd+V)

**Expected Results**:
✅ Button text changes to "✓ Copied!" 
✅ Button background turns green (#27ae60)
✅ Pasted text matches the displayed payment number
✅ After 2 seconds, button reverts to original state

---

### Scenario 4: Admin Assigns Payment Number

**Prerequisites**:
- User has made recharge request (see Scenario 1)
- Admin account is created and logged in

**Steps**:
1. Admin logs in
2. Click **"Payments"** in sidebar menu
3. See list of pending payments
4. Find the user's payment request
5. Click **"Assign #"** button

**Expected Results**:
✅ Alert shows message: "Payment number assigned: [MTN/VOD/BANK]123456789"
✅ Payment number format:
   - Starts with MTN, VOD, or BANK prefix
   - Contains 8-9 digits
   - Example: `MTN567890123` or `VOD987654321`
✅ Table reloads automatically
✅ Payment now shows assigned number in "Payment #" column

**Verify Assignment**:
```javascript
// Check admin's assigned numbers
JSON.parse(localStorage.getItem('adminPaymentNumbers'))
// Should show: { "PAY_timestamp": "MTN567890123" }
```

---

### Scenario 5: Admin Completes Payment

**Prerequisites**:
- Payment has assigned number (see Scenario 4)
- Admin is in Payments section
- User initially has GHC 0 balance

**Steps**:
1. Find the payment in the table
2. Click **"Complete"** button

**Expected Results**:
✅ Alert shows: "Payment completed successfully"
✅ Payment status changes from orange (pending) to green (completed)
✅ Payment disappears from view (only pending payments shown by default)
✅ Verify user's balance updated

**Verify User Balance Updated**:
```javascript
// Check user's financial data
const user = JSON.parse(localStorage.getItem('currentUser'));
const finance = JSON.parse(localStorage.getItem('userFinance_' + user.userId));
console.log(finance.balance)  // Should be 100

// Check deposits
console.log(finance.deposits)  // Should contain new deposit record
```

---

### Scenario 6: Search Payments (Admin)

**Prerequisites**:
- Multiple payments in system
- Admin is in Payments section

**Steps**:
1. Type user's name in search box
2. Observe table updates
3. Clear search box
4. Type user's email
5. Observe table updates
6. Clear search box
7. Type payment ID (PAY_timestamp)
8. Observe table updates

**Expected Results**:
✅ Table filters in real-time as you type
✅ Shows only matching payments
✅ Search works by:
   - User full name (partial match)
   - User email (partial match)
   - Payment ID (exact match)
✅ Clearing search shows all payments again

---

### Scenario 7: Cancel Payment (Admin)

**Prerequisites**:
- Payment is still in pending status
- Admin is in Payments section

**Steps**:
1. Find a pending payment
2. Click **"Cancel"** button
3. Confirm the cancellation action

**Expected Results**:
✅ Payment status changes from orange (pending) to red (cancelled)
✅ Alert confirms: "Payment cancelled"
✅ Table reloads
✅ Status color changes to red (#e74c3c)

---

### Scenario 8: View Completed Payment Details

**Prerequisites**:
- Payment has been completed
- Admin is in Payments section

**Steps**:
1. Look for payment with green (completed) status
2. Click **"View"** button

**Expected Results**:
✅ Alert displays detailed payment information:
```
Payment ID: PAY_1699564800000
User: John Doe (john@example.com)
Amount: GHC 100.00
Method: MTN
Phone: 233501234567
Status: completed
Payment Number: MTN567890123
Requested: 2023-11-10T10:30:00.000Z
Completed: 2023-11-10T10:35:00.000Z
```

---

### Scenario 9: Both home.html and mine.html Work

**Prerequisites**:
- User is logged in
- User can access both pages

**Steps**:
1. Go to home.html
2. Click "Recharge"
3. Fill and submit form
4. Note the payment request ID
5. Go to mine.html
6. Click "Recharge"
7. Fill and submit another form with different amount
8. Go to admin panel
9. Check Payments section

**Expected Results**:
✅ Both payments appear in admin's list
✅ Same form IDs work on both pages
✅ Same payment system logic applies
✅ Both payments can be assigned and completed

---

## Data Structure Verification

### Check Pending Payments
```javascript
// In browser console
const payments = JSON.parse(localStorage.getItem('pendingPayments'));
console.table(payments);

// Verify structure:
// Each payment should have:
// - id: 'PAY_' + timestamp
// - userId: user's ID
// - userName: user's full name
// - amount: number
// - paymentMethod: 'mtn', 'vodafone', 'bank'
// - phone: string
// - status: 'pending', 'completed', 'cancelled'
// - paymentNumber: null or assigned number
// - requestedAt: ISO timestamp
// - createdAt: ISO timestamp
```

### Check Admin Payment Numbers
```javascript
// In browser console
const assignedNumbers = JSON.parse(localStorage.getItem('adminPaymentNumbers'));
console.log(assignedNumbers);

// Verify format:
// Should be object like:
// {
//   "PAY_1699564800000": "MTN123456789",
//   "PAY_1699564801000": "VOD987654321"
// }
```

### Check User's Payment History
```javascript
// In browser console
const user = JSON.parse(localStorage.getItem('currentUser'));
const userPayments = JSON.parse(localStorage.getItem('userPayments_' + user.userId));
console.table(userPayments);

// Should match pendingPayments array entries for that user
```

### Check User's Financial Data
```javascript
// In browser console
const user = JSON.parse(localStorage.getItem('currentUser'));
const finance = JSON.parse(localStorage.getItem('userFinance_' + user.userId));
console.log('Balance:', finance.balance);
console.log('Deposits:', finance.deposits);

// After completing payment, balance should increase
// Deposits array should have new entry with:
// - id: 'DEP_' + timestamp
// - amount: payment amount
// - source: 'recharge'
// - paymentId: corresponding payment ID
// - date: ISO timestamp
```

---

## Admin Testing Checklist

- [ ] Can see Payments menu in sidebar
- [ ] Payments table displays all pending payments
- [ ] Payment fields display correctly (User, Amount, Method, Status, Payment #)
- [ ] Status colors are correct (pending=orange, completed=green, cancelled=red)
- [ ] Can assign payment numbers to pending payments
- [ ] Payment numbers are properly formatted (PREFIX + digits)
- [ ] Can complete payment and user balance updates
- [ ] Can cancel payment
- [ ] Can view completed payment details
- [ ] Search works for user name
- [ ] Search works for email
- [ ] Search works for payment ID
- [ ] Clearing search shows all payments again
- [ ] Table refreshes after each action
- [ ] No console errors

---

## User Testing Checklist

- [ ] Can access Recharge from home.html
- [ ] Can access Recharge from mine.html
- [ ] Form accepts valid inputs
- [ ] Form rejects invalid amounts
- [ ] Form rejects invalid phones
- [ ] Payment Details modal displays
- [ ] Can copy payment number
- [ ] Copied number matches displayed number
- [ ] Payment request created in localStorage
- [ ] Can see payment number after admin assigns

---

## Troubleshooting

### Payment Not Appearing in Admin List
```javascript
// Check if localStorage has pending payments
const payments = JSON.parse(localStorage.getItem('pendingPayments'));
console.log(payments);

// If empty, check user payments
const user = JSON.parse(localStorage.getItem('currentUser'));
const userPayments = JSON.parse(localStorage.getItem('userPayments_' + user.userId));
console.log(userPayments);
```

### Payment Number Not Assigned
```javascript
// Check admin numbers object
const numbers = JSON.parse(localStorage.getItem('adminPaymentNumbers'));
console.log(numbers);

// Should contain payment ID as key
```

### Balance Not Updated
```javascript
// Check user's financial record
const user = JSON.parse(localStorage.getItem('currentUser'));
const finance = JSON.parse(localStorage.getItem('userFinance_' + user.userId));
console.log('Current balance:', finance.balance);
console.log('Deposits:', finance.deposits);

// Check if payment status is 'completed'
const payments = JSON.parse(localStorage.getItem('pendingPayments'));
console.log(payments);
```

### Copy Button Not Working
- Try refreshing the page
- Check browser console for errors
- Verify JavaScript is enabled
- Try with a different browser

---

## Performance Notes

- Payment system uses localStorage (client-side only)
- Suitable for small to medium user bases
- For production with many users, consider:
  - Backend database
  - Real-time updates
  - Payment validation API

---

**Last Updated**: November 2024
**Version**: 1.0
