/**
 * Centralized Data Management System
 * Manages user balances, bonuses, task completion, and syncs across all pages
 */

const DataManager = {
    // Admin data helpers
    getAdminData: function() {
        return JSON.parse(localStorage.getItem('adminData') || '{}');
    },

    saveAdminData: function(adminData) {
        localStorage.setItem('adminData', JSON.stringify(adminData));
    },

    // User task helpers
    getUserTasks: function(userId) {
        const data = localStorage.getItem(`userTasks_${userId}`);
        if (data) return JSON.parse(data);
        const empty = { pending: [], frozen: [], completed: [] };
        localStorage.setItem(`userTasks_${userId}`, JSON.stringify(empty));
        return empty;
    },

    saveUserTasks: function(userId, tasks) {
        localStorage.setItem(`userTasks_${userId}`, JSON.stringify(tasks));
        this.syncAllPages(userId);
    },

    getTaskTemplate: function(taskId) {
        const adminData = this.getAdminData();
        return (adminData.tasks || []).find(t => t.id === taskId) || null;
    },

    assignTaskToUser: function(userId, taskId) {
        const taskTemplate = this.getTaskTemplate(taskId);
        if (!taskTemplate) return { success: false, reason: 'task_not_found' };

        const tasks = this.getUserTasks(userId);
        const alreadyAssigned = ['pending', 'frozen', 'completed']
            .some(status => (tasks[status] || []).some(t => t.id === taskId));

        if (alreadyAssigned) return { success: false, reason: 'already_assigned' };

        const taskInstance = {
            ...taskTemplate,
            status: 'pending',
            assignedAt: new Date().toISOString()
        };

        tasks.pending = tasks.pending || [];
        tasks.pending.push(taskInstance);
        this.saveUserTasks(userId, tasks);
        return { success: true };
    },

    assignTaskToUsers: function(userIds, taskId) {
        let assigned = 0;
        let skipped = 0;
        userIds.forEach(userId => {
            const result = this.assignTaskToUser(userId, taskId);
            if (result.success) assigned += 1;
            else skipped += 1;
        });
        return { assigned, skipped };
    },

    // Product assignment helpers
    getProductTemplate: function(productId) {
        const adminData = this.getAdminData();
        return (adminData.products || []).find(p => p.id === productId) || null;
    },

    getUserProducts: function(userId) {
        const data = localStorage.getItem(`userProducts_${userId}`);
        if (data) return JSON.parse(data);
        return [];
    },

    saveUserProducts: function(userId, products) {
        localStorage.setItem(`userProducts_${userId}`, JSON.stringify(products));
        this.syncAllPages(userId);
    },

    assignProductToUser: function(userId, productId) {
        const productTemplate = this.getProductTemplate(productId);
        if (!productTemplate) return { success: false, reason: 'product_not_found' };

        const userProducts = this.getUserProducts(userId);
        const alreadyAssigned = userProducts.some(p => p.id === productId);

        if (alreadyAssigned) return { success: false, reason: 'already_assigned' };

        const productInstance = {
            ...productTemplate,
            assignedAt: new Date().toISOString()
        };

        userProducts.push(productInstance);
        this.saveUserProducts(userId, userProducts);
        return { success: true };
    },

    assignProductToUsers: function(userIds, productId) {
        let assigned = 0;
        let skipped = 0;
        userIds.forEach(userId => {
            const result = this.assignProductToUser(userId, productId);
            if (result.success) assigned += 1;
            else skipped += 1;
        });
        return { assigned, skipped };
    },

    completeUserTask: function(userId, taskId) {
        const tasks = this.getUserTasks(userId);
        const pendingIndex = (tasks.pending || []).findIndex(t => t.id === taskId);
        if (pendingIndex === -1) return null;

        const task = tasks.pending.splice(pendingIndex, 1)[0];
        task.status = 'completed';
        task.completedAt = new Date().toISOString();

        tasks.completed = tasks.completed || [];
        tasks.completed.push(task);
        this.saveUserTasks(userId, tasks);
        return task;
    },

    // Assign product as task
    assignProductAsTask: function(userId, productId) {
        const productTemplate = this.getProductTemplate(productId);
        if (!productTemplate) return { success: false, reason: 'product_not_found' };

        const tasks = this.getUserTasks(userId);
        const alreadyAssigned = ['pending', 'frozen', 'completed']
            .some(status => (tasks[status] || []).some(t => t.productId === productId));

        if (alreadyAssigned) return { success: false, reason: 'already_assigned' };

        const taskInstance = {
            id: productId,
            productId: productId,
            title: `Order: ${productTemplate.name}`,
            description: productTemplate.description,
            amount: productTemplate.price,
            productImage: productTemplate.image,
            status: 'pending',
            isProduct: true,
            assignedAt: new Date().toISOString()
        };

        tasks.pending = tasks.pending || [];
        tasks.pending.push(taskInstance);
        this.saveUserTasks(userId, tasks);
        return { success: true };
    },

    assignProductAsTaskToUsers: function(userIds, productId) {
        let assigned = 0;
        let skipped = 0;
        userIds.forEach(userId => {
            const result = this.assignProductAsTask(userId, productId);
            if (result.success) assigned += 1;
            else skipped += 1;
        });
        return { assigned, skipped };
    }
    // Initialize user financial data
    initializeUser: function(userId) {
        const existingData = localStorage.getItem(`userFinance_${userId}`);
        if (!existingData) {
            const financialData = {
                userId: userId,
                balance: 0,
                bonus: 0,
                totalEarnings: 0,
                tasksCompleted: 0,
                tasksInProgress: 0,
                withdrawalsPending: 0,
                depositsPending: 0,
                lastUpdated: new Date().toISOString(),
                transactions: [],
                taskHistory: []
            };
            localStorage.setItem(`userFinance_${userId}`, JSON.stringify(financialData));
        }
        return this.getUserFinance(userId);
    },

    // Get user financial data
    getUserFinance: function(userId) {
        const data = localStorage.getItem(`userFinance_${userId}`);
        return data ? JSON.parse(data) : null;
    },

    // Update balance (called when tasks are completed or withdrawal approved)
    updateBalance: function(userId, amount, type = 'credit', reason = '') {
        const finance = this.getUserFinance(userId);
        if (!finance) return null;

        if (type === 'credit') {
            finance.balance += amount;
            finance.totalEarnings += amount;
        } else if (type === 'debit') {
            if (finance.balance >= amount) {
                finance.balance -= amount;
            } else {
                console.error('Insufficient balance');
                return null;
            }
        }

        // Record transaction
        finance.transactions.push({
            date: new Date().toISOString(),
            type: type,
            amount: amount,
            balance: finance.balance,
            reason: reason
        });

        finance.lastUpdated = new Date().toISOString();
        localStorage.setItem(`userFinance_${userId}`, JSON.stringify(finance));
        this.syncAllPages(userId);
        return finance;
    },

    // Update bonus
    updateBonus: function(userId, amount, reason = '') {
        const finance = this.getUserFinance(userId);
        if (!finance) return null;

        finance.bonus += amount;

        // Record bonus transaction
        finance.transactions.push({
            date: new Date().toISOString(),
            type: 'bonus',
            amount: amount,
            bonus: finance.bonus,
            reason: reason
        });

        finance.lastUpdated = new Date().toISOString();
        localStorage.setItem(`userFinance_${userId}`, JSON.stringify(finance));
        this.syncAllPages(userId);
        return finance;
    },

    // Complete a task and add earnings
    completeTask: function(userId, taskId, taskTitle, earnings, bonus = 0) {
        const finance = this.getUserFinance(userId);
        if (!finance) return null;

        // Add earnings
        finance.balance += earnings;
        if (bonus > 0) {
            finance.bonus += bonus;
        }
        finance.tasksCompleted += 1;

        // Record task completion
        finance.taskHistory.push({
            taskId: taskId,
            taskTitle: taskTitle,
            completedDate: new Date().toISOString(),
            earnings: earnings,
            bonus: bonus,
            status: 'completed'
        });

        finance.transactions.push({
            date: new Date().toISOString(),
            type: 'task_completion',
            amount: earnings,
            bonus: bonus,
            reason: `Task completed: ${taskTitle}`,
            balance: finance.balance
        });

        finance.lastUpdated = new Date().toISOString();
        localStorage.setItem(`userFinance_${userId}`, JSON.stringify(finance));
        
        // Also update currentUser
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser && currentUser.userId === userId) {
            currentUser.balance = finance.balance;
            currentUser.bonus = finance.bonus;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
        }
        
        this.syncAllPages(userId);
        return finance;
    },

    // Request withdrawal
    requestWithdrawal: function(userId, amount, method) {
        const finance = this.getUserFinance(userId);
        if (!finance) return null;

        if (finance.balance < amount) {
            console.error('Insufficient balance for withdrawal');
            return null;
        }

        // Create withdrawal request
        const withdrawalId = 'WD_' + Date.now();
        const withdrawal = {
            withdrawalId: withdrawalId,
            userId: userId,
            amount: amount,
            method: method,
            status: 'pending',
            requestDate: new Date().toISOString(),
            approvalDate: null
        };

        // Store withdrawal request in admin data
        let adminData = JSON.parse(localStorage.getItem('adminData') || '{"withdrawals":[]}');
        if (!adminData.withdrawals) adminData.withdrawals = [];
        adminData.withdrawals.push(withdrawal);
        localStorage.setItem('adminData', JSON.stringify(adminData));

        finance.withdrawalsPending += 1;
        finance.transactions.push({
            date: new Date().toISOString(),
            type: 'withdrawal_request',
            amount: amount,
            status: 'pending',
            reason: `Withdrawal request: ${method}`
        });

        finance.lastUpdated = new Date().toISOString();
        localStorage.setItem(`userFinance_${userId}`, JSON.stringify(finance));

        return { finance: finance, withdrawal: withdrawal };
    },

    // Admin: Approve withdrawal
    approveWithdrawal: function(withdrawalId) {
        let adminData = JSON.parse(localStorage.getItem('adminData') || '{"withdrawals":[]}');
        const withdrawal = adminData.withdrawals.find(w => w.withdrawalId === withdrawalId);

        if (!withdrawal) return null;

        withdrawal.status = 'approved';
        withdrawal.approvalDate = new Date().toISOString();

        // Deduct from user balance
        const finance = this.getUserFinance(withdrawal.userId);
        finance.balance -= withdrawal.amount;
        finance.withdrawalsPending -= 1;

        finance.transactions.push({
            date: new Date().toISOString(),
            type: 'withdrawal_approved',
            amount: withdrawal.amount,
            reason: `Withdrawal approved and processed`,
            balance: finance.balance
        });

        finance.lastUpdated = new Date().toISOString();
        localStorage.setItem(`userFinance_${withdrawal.userId}`, JSON.stringify(finance));
        localStorage.setItem('adminData', JSON.stringify(adminData));

        // Update currentUser if applicable
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser && currentUser.userId === withdrawal.userId) {
            currentUser.balance = finance.balance;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
        }

        this.syncAllPages(withdrawal.userId);
        return { finance: finance, withdrawal: withdrawal };
    },

    // Admin: Reject withdrawal
    rejectWithdrawal: function(withdrawalId, reason = '') {
        let adminData = JSON.parse(localStorage.getItem('adminData') || '{"withdrawals":[]}');
        const withdrawal = adminData.withdrawals.find(w => w.withdrawalId === withdrawalId);

        if (!withdrawal) return null;

        withdrawal.status = 'rejected';
        withdrawal.rejectionReason = reason;

        const finance = this.getUserFinance(withdrawal.userId);
        finance.withdrawalsPending -= 1;

        finance.transactions.push({
            date: new Date().toISOString(),
            type: 'withdrawal_rejected',
            amount: withdrawal.amount,
            reason: `Withdrawal rejected: ${reason}`
        });

        finance.lastUpdated = new Date().toISOString();
        localStorage.setItem(`userFinance_${withdrawal.userId}`, JSON.stringify(finance));
        localStorage.setItem('adminData', JSON.stringify(adminData));

        this.syncAllPages(withdrawal.userId);
        return { finance: finance, withdrawal: withdrawal };
    },

    // Admin: Add deposit/bonus to user
    addDeposit: function(userId, amount, bonus = 0, reason = '') {
        const finance = this.getUserFinance(userId);
        if (!finance) return null;

        finance.balance += amount;
        if (bonus > 0) {
            finance.bonus += bonus;
        }

        finance.transactions.push({
            date: new Date().toISOString(),
            type: 'admin_deposit',
            amount: amount,
            bonus: bonus,
            reason: reason || 'Admin deposit',
            balance: finance.balance
        });

        finance.lastUpdated = new Date().toISOString();
        localStorage.setItem(`userFinance_${userId}`, JSON.stringify(finance));

        // Update currentUser if applicable
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser && currentUser.userId === userId) {
            currentUser.balance = finance.balance;
            currentUser.bonus = finance.bonus;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
        }

        this.syncAllPages(userId);
        return finance;
    },

    // Get all transactions for a user
    getUserTransactions: function(userId) {
        const finance = this.getUserFinance(userId);
        return finance ? finance.transactions : [];
    },

    // Get task history
    getUserTaskHistory: function(userId) {
        const finance = this.getUserFinance(userId);
        return finance ? finance.taskHistory : [];
    },

    // Get pending withdrawals for admin
    getPendingWithdrawals: function() {
        let adminData = JSON.parse(localStorage.getItem('adminData') || '{"withdrawals":[]}');
        return adminData.withdrawals ? adminData.withdrawals.filter(w => w.status === 'pending') : [];
    },

    // Get all withdrawals for admin
    getAllWithdrawals: function() {
        let adminData = JSON.parse(localStorage.getItem('adminData') || '{"withdrawals":[]}');
        return adminData.withdrawals || [];
    },

    // Sync financial data across all open pages
    syncAllPages: function(userId) {
        // Broadcast message to update all pages
        const event = new CustomEvent('userFinanceUpdated', {
            detail: { userId: userId, finance: this.getUserFinance(userId) }
        });
        window.dispatchEvent(event);
    },

    // Process order: deduct balance, add bonus after delay
    processOrder: function(userId, orderAmount, profitPercent = 21.5) {
        const finance = this.getUserFinance(userId);
        if (!finance) return { success: false, reason: 'user_not_found' };

        if (finance.balance < orderAmount) {
            return { success: false, reason: 'insufficient_balance' };
        }

        // Deduct from balance
        finance.balance -= orderAmount;

        // Calculate profit (21.5% = 4.30 from 20)
        const profit = Math.round((orderAmount * profitPercent / 100) * 100) / 100;

        // Create order record
        const order = {
            orderId: 'ORD_' + Date.now(),
            userId: userId,
            orderAmount: orderAmount,
            profit: profit,
            status: 'completed',
            completedAt: new Date().toISOString()
        };

        // Record transaction
        finance.transactions.push({
            date: new Date().toISOString(),
            type: 'order_placed',
            amount: -orderAmount,
            bonus: profit,
            reason: `Order placed (Amount: GHC ${orderAmount}, Profit: GHC ${profit})`,
            balance: finance.balance
        });

        finance.lastUpdated = new Date().toISOString();
        localStorage.setItem(`userFinance_${userId}`, JSON.stringify(finance));

        // Async: Add bonus after loading completes
        setTimeout(() => {
            this.addBonusFromOrder(userId, profit, order.orderId);
        }, 6000); // 6 second delay (within 5-10 range)

        return { success: true, order: order, currentBalance: finance.balance };
    },

    addBonusFromOrder: function(userId, profit, orderId) {
        const finance = this.getUserFinance(userId);
        if (!finance) return null;

        finance.bonus += profit;
        finance.transactions.push({
            date: new Date().toISOString(),
            type: 'bonus_earned',
            amount: 0,
            bonus: profit,
            reason: `Bonus from order ${orderId}`,
            balance: finance.balance
        });

        finance.lastUpdated = new Date().toISOString();
        localStorage.setItem(`userFinance_${userId}`, JSON.stringify(finance));

        // Update currentUser if applicable
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser && currentUser.userId === userId) {
            currentUser.bonus = finance.bonus;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
        }

        this.syncAllPages(userId);
        return finance;
    },

    // Transfer bonus to balance
    transferBonusToBalance: function(userId, amount) {
        const finance = this.getUserFinance(userId);
        if (!finance) return null;

        if (finance.bonus < amount) {
            return { success: false, reason: 'insufficient_bonus' };
        }

        finance.bonus -= amount;
        finance.balance += amount;

        finance.transactions.push({
            date: new Date().toISOString(),
            type: 'bonus_transfer',
            amount: amount,
            bonus: -amount,
            reason: `Transferred GHC ${amount} from bonus to balance`,
            balance: finance.balance
        });

        finance.lastUpdated = new Date().toISOString();
        localStorage.setItem(`userFinance_${userId}`, JSON.stringify(finance));

        // Update currentUser if applicable
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser && currentUser.userId === userId) {
            currentUser.balance = finance.balance;
            currentUser.bonus = finance.bonus;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
        }

        this.syncAllPages(userId);
        return { success: true, finance: finance };
    },

    // Get system statistics for admin
    getSystemStats: function() {
        let stats = {
            totalUsers: 0,
            totalBalance: 0,
            totalBonus: 0,
            totalWithdrawals: 0,
            pendingWithdrawals: 0,
            approvedWithdrawals: 0,
            totalTasksCompleted: 0,
            activeTasks: 0
        };

        const adminData = this.getAdminData();
        stats.activeTasks = (adminData.tasks || []).filter(t => t.status === 'active').length;

        const allUsers = JSON.parse(localStorage.getItem('allUsers') || '[]');
        allUsers.forEach(user => {
            const finance = this.getUserFinance(user.userId);
            if (finance) {
                stats.totalUsers += 1;
                stats.totalBalance += finance.balance;
                stats.totalBonus += finance.bonus;
                stats.totalTasksCompleted += finance.tasksCompleted;
            }
        });

        const withdrawals = this.getAllWithdrawals();
        withdrawals.forEach(w => {
            stats.totalWithdrawals += w.amount;
            if (w.status === 'pending') stats.pendingWithdrawals += w.amount;
            if (w.status === 'approved') stats.approvedWithdrawals += w.amount;
        });

        return stats;
    }
};

// Listen for storage changes from other tabs/windows
window.addEventListener('storage', function(e) {
    if (e.key && e.key.startsWith('userFinance_')) {
        const event = new CustomEvent('userFinanceUpdated', {
            detail: { finance: JSON.parse(e.newValue) }
        });
        window.dispatchEvent(event);
    }
});

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataManager;
}
