/**
 * Audit Logging System
 * Tracks all user actions for accountability and debugging
 */

class AuditLogger {
    constructor() {
        this.db = firebase.database();
        this.maxLogsPerUser = 10000; // Limit logs to prevent database bloat
    }

    /**
     * Log an action
     * @param {string} action - Type of action (CREATE, UPDATE, DELETE, ISSUE, RETURN, etc)
     * @param {string} entity - Entity type (BOOK, STUDENT, ISSUANCE, LOST_BOOK)
     * @param {string} entityId - ID of the affected entity
     * @param {object} details - Additional details about the action
     */
    async log(action, entity, entityId, details = {}) {
        try {
            const user = firebase.auth().currentUser;
            if (!user) return; // Don't log if no user authenticated

            const logEntry = {
                timestamp: new Date().getTime(),
                date: new Date().toISOString(),
                action: action,
                entity: entity,
                entityId: entityId,
                userId: user.uid,
                userEmail: user.email,
                userName: user.displayName || 'Unknown',
                details: details,
                ipAddress: null // Would need server-side to capture
            };

            // Save to audit logs
            const newLogId = this.db.ref('audit_logs').push().key;
            await this.db.ref(`audit_logs/${newLogId}`).set(logEntry);

            // Also save to user-specific logs for quick access
            await this.db.ref(`user_logs/${user.uid}/${newLogId}`).set(logEntry);

            console.log('✓ Audit logged:', action, entity, entityId);
            return newLogId;
        } catch (error) {
            console.error('Error logging audit trail:', error);
        }
    }

    /**
     * Get all audit logs
     */
    async getAllLogs(limit = 500) {
        try {
            const snapshot = await this.db.ref('audit_logs')
                .orderByChild('timestamp')
                .limitToLast(limit)
                .once('value');

            if (!snapshot.exists()) return [];

            const logs = [];
            snapshot.forEach(child => {
                logs.push({
                    id: child.key,
                    ...child.val()
                });
            });

            return logs.reverse(); // Most recent first
        } catch (error) {
            console.error('Error fetching audit logs:', error);
            return [];
        }
    }

    /**
     * Get logs for a specific entity
     */
    async getEntityLogs(entityId, limit = 100) {
        try {
            const snapshot = await this.db.ref('audit_logs')
                .orderByChild('entityId')
                .equalTo(entityId)
                .once('value');

            if (!snapshot.exists()) return [];

            const logs = [];
            snapshot.forEach(child => {
                logs.push({
                    id: child.key,
                    ...child.val()
                });
            });

            return logs.reverse();
        } catch (error) {
            console.error('Error fetching entity logs:', error);
            return [];
        }
    }

    /**
     * Get logs for a specific user
     */
    async getUserLogs(userId, limit = 100) {
        try {
            const snapshot = await this.db.ref(`user_logs/${userId}`)
                .orderByChild('timestamp')
                .limitToLast(limit)
                .once('value');

            if (!snapshot.exists()) return [];

            const logs = [];
            snapshot.forEach(child => {
                logs.push({
                    id: child.key,
                    ...child.val()
                });
            });

            return logs.reverse();
        } catch (error) {
            console.error('Error fetching user logs:', error);
            return [];
        }
    }

    /**
     * Get logs by action type
     */
    async getLogsByAction(action, limit = 100) {
        try {
            const snapshot = await this.db.ref('audit_logs')
                .orderByChild('action')
                .equalTo(action)
                .once('value');

            if (!snapshot.exists()) return [];

            const logs = [];
            snapshot.forEach(child => {
                logs.push({
                    id: child.key,
                    ...child.val()
                });
            });

            return logs.reverse();
        } catch (error) {
            console.error('Error fetching logs:', error);
            return [];
        }
    }

    /**
     * Get logs within date range
     */
    async getLogsByDateRange(startDate, endDate, limit = 500) {
        try {
            const snapshot = await this.db.ref('audit_logs')
                .orderByChild('timestamp')
                .once('value');

            if (!snapshot.exists()) return [];

            const start = new Date(startDate).getTime();
            const end = new Date(endDate).getTime();

            const logs = [];
            snapshot.forEach(child => {
                const log = child.val();
                if (log.timestamp >= start && log.timestamp <= end) {
                    logs.push({
                        id: child.key,
                        ...log
                    });
                }
            });

            return logs.reverse();
        } catch (error) {
            console.error('Error fetching logs by date:', error);
            return [];
        }
    }

    /**
     * Export audit logs to CSV
     */
    async exportLogsToCSV(logs) {
        try {
            let csv = 'Date,Time,Action,Entity,Entity ID,User,Email,Details\n';

            logs.forEach(log => {
                const date = new Date(log.timestamp);
                const dateStr = date.toLocaleDateString();
                const timeStr = date.toLocaleTimeString();
                const details = JSON.stringify(log.details).replace(/"/g, '""');

                csv += `"${dateStr}","${timeStr}","${log.action}","${log.entity}","${log.entityId}","${log.userName}","${log.userEmail}","${details}"\n`;
            });

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `audit_logs_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            return true;
        } catch (error) {
            console.error('Error exporting logs:', error);
            return false;
        }
    }

    /**
     * Clear old logs (older than N days)
     */
    async clearOldLogs(daysOld = 90) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);
            const cutoffTime = cutoffDate.getTime();

            const snapshot = await this.db.ref('audit_logs').once('value');
            let deletedCount = 0;

            snapshot.forEach(child => {
                const log = child.val();
                if (log.timestamp < cutoffTime) {
                    this.db.ref(`audit_logs/${child.key}`).remove();
                    deletedCount++;
                }
            });

            console.log(`Cleared ${deletedCount} old audit logs`);
            return deletedCount;
        } catch (error) {
            console.error('Error clearing old logs:', error);
            return 0;
        }
    }

    /**
     * Get summary statistics
     */
    async getLogStatistics() {
        try {
            const logs = await this.getAllLogs(10000);

            const stats = {
                totalLogs: logs.length,
                actionBreakdown: {},
                entityBreakdown: {},
                userBreakdown: {},
                todayLogs: 0,
                thisWeekLogs: 0,
                thisMonthLogs: 0
            };

            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const weekAgo = today - (7 * 24 * 60 * 60 * 1000);
            const monthAgo = today - (30 * 24 * 60 * 60 * 1000);

            logs.forEach(log => {
                // Action breakdown
                stats.actionBreakdown[log.action] = (stats.actionBreakdown[log.action] || 0) + 1;

                // Entity breakdown
                stats.entityBreakdown[log.entity] = (stats.entityBreakdown[log.entity] || 0) + 1;

                // User breakdown
                stats.userBreakdown[log.userName] = (stats.userBreakdown[log.userName] || 0) + 1;

                // Time-based breakdown
                if (log.timestamp >= today) stats.todayLogs++;
                if (log.timestamp >= weekAgo) stats.thisWeekLogs++;
                if (log.timestamp >= monthAgo) stats.thisMonthLogs++;
            });

            return stats;
        } catch (error) {
            console.error('Error getting log statistics:', error);
            return null;
        }
    }
}

// Initialize audit logger
const auditLogger = new AuditLogger();

// Make it global
window.auditLogger = auditLogger;
