# 🎯 Quick Start - Authentication Testing

## Step 1: Register a New User

**URL**: http://localhost:5500/register.html

### Test Account Details
Use these credentials for testing:
```
First Name: Test
Last Name: User
Email: testuser@dailytrade.com
Phone: 555123456 (Ghana format)
Password: TestPass123! (meets all requirements)
```

**Form Fields:**
- ✅ First Name: min 2 characters
- ✅ Last Name: min 2 characters
- ✅ Email: valid email format, must be unique
- ✅ Phone: 9+ digits (stored as +233555123456)
- ✅ Password: min 8 chars, strength meter shown
- ✅ Confirm Password: must match
- ✅ Terms: must be checked

**Expected Result:**
- Green success message appears
- After 1.5 seconds, redirects to login page
- New user stored in localStorage

---

## Step 2: Login as Test User

**URL**: http://localhost:5500/index.html

### Login with registered credentials
```
Email: testuser@dailytrade.com
Password: TestPass123!
```

**Expected Result:**
- Login successful
- Redirected to home.html
- User dashboard displays with balance: GHC 0.00

---

## Step 3: Access Admin Panel

**URL**: http://localhost:5500/admin-login.html

### Login with admin credentials
```
Username: admin
Password: admin123
```

**Expected Result:**
- Admin panel loads
- Full admin dashboard visible
- Can create tasks and products

---

## Step 4: Admin - Create a Task

In Admin Dashboard > Tasks section:

1. Click "Add Task"
2. Fill in:
   - Task Name: "Complete Survey"
   - Reward: "5.00"
   - Description: "Complete customer feedback survey"
3. Click "Create Task"
4. Select the test user (Test User)
5. Click "Assign Task"

**Expected Result:**
- Task appears in admin's task list
- Shows "Assigned to 1 user"

---

## Step 5: User - View Assigned Task

1. Logout from admin (back to index.html)
2. Login as test user:
   - Email: testuser@dailytrade.com
   - Password: TestPass123!
3. Navigate to "Tasks" section
4. Find "Complete Survey" task

**Expected Result:**
- Task displays with GHC 5.00 reward
- "Mark Completed" button visible
- Task status: Pending

---

## Step 6: Admin - Create a Product

In Admin Dashboard > Products section:

1. Click "Add Product"
2. Fill in:
   - Product Name: "Gift Card"
   - Price: "20.00"
   - Profit Bonus: "4.30"
3. Upload an image (any image file)
4. Click "Create Product"

**Expected Result:**
- Product created
- Image preview shows
- Product appears in list

---

## Step 7: Assign Product as Task

In Admin > Products:

1. Find the "Gift Card" product
2. Click "Assign to Users"
3. Select the test user
4. Click "Assign Product as Task"

**Expected Result:**
- Product becomes a task for the user
- Task includes the product image

---

## Step 8: Complete Product Order

As test user:

1. Navigate to "Tasks"
2. Find the "Gift Card" task with image
3. Click "Place Order" (not "Mark Completed")
4. Watch the 6-second loading animation
5. Order completes with GHC 4.30 bonus

**Expected Result:**
- Loading animation shows 6 seconds
- Task moves to "Frozen" state
- After 6 seconds, moves to "Completed"
- Bonus added to balance
- Can transfer bonus to main balance

---

## Troubleshooting

### Registration Issues
- **Email already exists?** → Use a different email address
- **Password validation fails?** → Must be 8+ chars with numbers and symbols
- **Form doesn't submit?** → Check all fields are filled and terms checked

### Login Issues
- **Invalid credentials?** → Check email spelling and password
- **Page doesn't load?** → Ensure JavaScript is enabled
- **Redirects to login after logout?** → Normal behavior, login again

### Task/Product Issues
- **Tasks not showing?** → User must be assigned tasks by admin
- **Admin dashboard blank?** → Ensure admin is logged in correctly
- **Images not loading?** → Check image was uploaded correctly

---

## Verification Checklist

- [ ] User registration works
- [ ] New user data saved to localStorage
- [ ] User login works
- [ ] Session persists on page refresh
- [ ] Admin login works with default credentials
- [ ] Can create tasks in admin panel
- [ ] Can create products with image uploads
- [ ] Can assign tasks to users
- [ ] Can assign products as tasks
- [ ] User sees assigned tasks
- [ ] User can complete tasks
- [ ] Product orders trigger 6-second timer
- [ ] Bonus added after order completion
- [ ] Can transfer bonus to balance
- [ ] Logout clears session and redirects to login

---

## Browser DevTools - Verify Data

**Inspect localStorage to verify:**

1. Open DevTools (F12)
2. Go to Application > Local Storage > http://localhost:5500

**Keys to check:**
- `currentUser` - logged-in user object
- `isLoggedIn` - should be "true"
- `allUsers` - array of all users
- `userFinance_USER_ID` - user's balance and transactions
- `userTasks_USER_ID` - user's task list
- `adminLoggedIn` - should be "true" when logged as admin

---

## Complete Authentication Flow

```
START
  ↓
register.html (Create Account)
  ↓ (Success)
index.html (Login Page)
  ↓ (Enter Credentials)
home.html (Dashboard)
  ├─ tasks.html (View & Complete Tasks)
  ├─ work.html (Leaderboard)
  ├─ mine.html (Profile)
  └─ [Logout] → index.html
```

---

## Notes

- ✅ All authentication is **client-side** using localStorage
- ✅ Passwords stored as plain text (development only)
- ✅ Each user gets unique ID: `USER_${timestamp}`
- ✅ Admin uses fixed credentials: admin/admin123
- ✅ All data persists across page refreshes
- ✅ Clearing browser cache will clear all user data
- ✅ Multiple users can register and login separately

---

**Ready to test? Start here:** http://localhost:5500/register.html
