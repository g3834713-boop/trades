# 👑 Admin Panel - User Management & Task Assignment

## Overview

The DailyTrade admin panel provides complete control over user management, task creation, product management, and financial operations. **All registered users are automatically available for task and product assignment.**

---

## 📱 User Management Section

### Viewing All Users

**Path**: Admin Panel > Users (left sidebar)

The Users section displays a complete table of all registered users with the following columns:

| Column | Details |
|--------|---------|
| **Name** | User's full name |
| **Email** | Email address (used for login) |
| **User ID** | Unique identifier (USER_timestamp) |
| **Balance** | Current GHC balance |
| **Actions** | Edit or Delete buttons |

### Features

✅ **Search Users** - Filter by name or email
✅ **View Balance** - See current account balance
✅ **Edit Balance** - Manually adjust user balance
✅ **Delete User** - Remove user and all associated data

### User Data Structure

When a user registers, they are stored with:
```json
{
  "id": "USER_1735689012345",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+233500123456",
  "fullName": "John Doe",
  "isAdmin": false,
  "registeredAt": "2024-01-01T10:30:00Z"
}
```

---

## 📋 Task Management - User Assignment

### Creating a Task

**Path**: Admin Panel > Tasks > "Add Task" button

1. **Task Name**: e.g., "Complete Survey"
2. **Reward**: GHC amount (e.g., "5.00")
3. **Description**: Task details
4. **Quantity**: Optional quantity field
5. Click **"Create Task"** button

### Assigning Tasks to Users

After creating a task, the admin can assign it to users:

1. In the Tasks section, click **"Assign"** button next to the task
2. Assignment modal opens with two options:

#### Option A: Assign to All Users
- Select radio button: "All Users"
- Click **"Assign"**
- Task is assigned to every registered user in the system

#### Option B: Assign to Selected Users
- Select radio button: "Selected Users"
- A checklist appears showing all registered users
- Each user displays:
  - Full name
  - Email address
  - Checkbox for selection
- Check the boxes for users you want to assign to
- Click **"Assign"**
- Task is assigned only to selected users

### User Selection Checklist

The assignment modal shows users in an easy-to-select format:

```
□ John Doe (john@example.com)
□ Jane Smith (jane@example.com)
□ Test User (testuser@dailytrade.com)
[... more users ...]
```

✅ **Click checkboxes** to select/deselect users
✅ **Scroll** if more than 6 users (180px max height)
✅ **All Users option** instantly assigns to everyone without selection

### Task Assignment Logic

```
When Admin clicks "Assign":
  1. Get selected assignment scope (all or selected)
  2. If "all users": assign to all registered users
  3. If "selected users": assign to checked users only
  4. Each user gets the task in their "pending" state
  5. User can view in Tasks > Pending section
```

---

## 🛍️ Product Management - User Assignment

### Creating a Product

**Path**: Admin Panel > Products > "Add Product" button

1. **Product Name**: e.g., "Gift Card"
2. **Description**: Product details
3. **Price**: GHC amount (e.g., "20.00") 
4. **Profit Bonus**: Reward amount (e.g., "4.30")
5. **Product Image**: Upload image file
6. Click **"Create Product"** button

### Assigning Products as Tasks

Products can be assigned to users as special tasks:

1. In Products section, click **"Assign"** button next to product
2. Assignment modal opens (same as task assignment)
3. **Select scope**: All Users OR Selected Users
4. **Choose users**: Check boxes in the user list
5. Click **"Assign Product as Task"**

### Product Assignment Result

When a product is assigned to a user:
- User sees it in Tasks section as a special "product task"
- Task card displays the product image
- Button shows "Place Order" instead of "Mark Completed"
- User can place order to:
  - Deduct GHC 20 from balance
  - Wait 6 seconds for processing
  - Receive GHC 4.30 bonus
  - Transfer bonus to balance

---

## 💰 Deposits Section

### Manual Deposit Management

**Path**: Admin Panel > Deposits

### Adding a Manual Deposit

1. Click **"Add Manual Deposit"** button
2. Modal opens with form:
   - **Select User**: Dropdown showing all registered users
   - **Amount**: GHC amount to add
   - **Bonus**: Optional bonus amount
3. Click **"Process Deposit"**
4. Balance is added to selected user's account

### Deposit Display

Deposits table shows:
| User | Amount | Status | Date | Action |
|------|--------|--------|------|--------|
| John Doe | GHC 50.00 | Completed | 1/15/2025 | Delete |
| Jane Smith | GHC 100.00 | Completed | 1/14/2025 | Delete |

---

## 📊 Dashboard Statistics

The Dashboard displays real-time stats updated from registered users:

- **Total Users**: Count of all registered users
- **Total Deposits**: Sum of all deposits
- **Total Payouts**: Sum of all withdrawals  
- **Active Tasks**: Count of tasks created

### Recent Users Widget

Shows the most recently registered users with:
- User name
- Registration date
- User ID

---

## 🎯 Admin Workflow - Step by Step

### Complete User Onboarding Workflow

```
1. USER REGISTERS
   └─ User creates account on register.html
      └─ User data stored in allUsers array
      └─ User financial data initialized (0 balance)

2. ADMIN VIEWS USER
   └─ Admin logs in (admin/admin123)
   └─ Admin Panel > Users
   └─ User appears in the users table

3. ADMIN CREATES TASK
   └─ Admin Panel > Tasks > "Add Task"
   └─ Fill task details
   └─ Click "Create Task"

4. ADMIN ASSIGNS TASK TO USER
   └─ Admin Panel > Tasks > "Assign" button
   └─ Select "Selected Users"
   └─ Check the user's checkbox
   └─ Click "Assign"

5. USER RECEIVES TASK
   └─ User logs in
   └─ Goes to Tasks section
   └─ Sees the assigned task
   └─ Can complete or earn rewards

6. ADMIN ADDS DEPOSIT (OPTIONAL)
   └─ Admin Panel > Deposits
   └─ Click "Add Manual Deposit"
   └─ Select user from dropdown
   └─ Enter amount
   └─ Click "Process Deposit"
   └─ User balance increases
```

---

## ⚙️ Key Features

### ✅ Dynamic User List
- Users are loaded in real-time from localStorage
- New users appear immediately without page refresh
- Search/filter works across all registered users

### ✅ Flexible Assignment
- Assign to all users at once for quick setup
- Select specific users for targeted assignments
- Reassign tasks/products as needed

### ✅ Real-Time Balance Updates
- Admin can see current balance for each user
- Balance updates after deposits, payouts, orders
- Edit balance manually if needed

### ✅ Product Integration
- Products appear as special tasks for users
- Product images display in user's task cards
- Separate order processing vs regular task completion

### ✅ Search & Filter
- Search users by name or email
- Filter results displayed in real-time
- Maintains full user information while filtering

---

## 🔄 User Selection - Technical Details

### Where Users Appear

1. **Users Section**: Full user table with all details
2. **Task Assignment Modal**: Checkboxes for each user
3. **Product Assignment Modal**: Checkboxes for each user
4. **Deposit Dropdown**: User names for selection
5. **Dashboard**: Recent users widget

### Data Sources

All user lists are pulled from:
```javascript
localStorage.getItem('allUsers')  // JSON array of all registered users
```

### User ID Handling

The system supports both user ID formats:
- `user.id` (newer format from registration)
- `user.userId` (alternative format)

Admin functions automatically use: `user.id || user.userId`

---

## 💡 Pro Tips

### Tip 1: Quick User Assignment
- Use "All Users" option to assign to everyone instantly
- Perfect for new tasks you want all users to see

### Tip 2: Targeted Tasks
- Use "Selected Users" to test with specific users
- Useful for VIP users or special promotions

### Tip 3: Balance Management
- Monitor user balances in the Users section
- Add deposits to boost accounts for testing
- Use Edit Balance for quick adjustments

### Tip 4: Search & Find
- Use search to quickly find specific users
- Search by name or email in Users section
- Filters apply to the display only

### Tip 5: Product Testing
- Create a product with test data
- Assign to 1-2 users for testing
- Verify order processing works correctly

---

## 🚨 Important Notes

### User Data Persistence
- All user data stored in browser localStorage
- Data persists across page refreshes
- Clearing browser cache deletes all data

### Real-Time Updates
- Adding users in register.html immediately shows in admin
- No refresh needed for user lists
- Task/product assignments take effect immediately

### Admin-Only Access
- Admin panel requires login (admin/admin123)
- Only accessible from admin-login.html
- Admin session persists in localStorage

### Default Admin Credentials
```
Username: admin
Password: admin123
```

---

## Testing Checklist

Use this checklist to verify all user assignment features:

- [ ] Can view all registered users in Users section
- [ ] Can search/filter users by name and email
- [ ] Can see user balances correctly
- [ ] Can edit user balance
- [ ] Can create a new task
- [ ] Can assign task to all users
- [ ] Can assign task to selected users
- [ ] Can see all users in task assignment checkbox list
- [ ] Can create a product with image
- [ ] Can assign product as task to all users
- [ ] Can assign product as task to selected users
- [ ] Can see product images in user's task cards
- [ ] Can add manual deposit to users
- [ ] Can delete users
- [ ] Dashboard shows correct total user count

---

**Ready to manage users? Start here:** http://localhost:5500/admin-login.html
