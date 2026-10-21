// Audit Logger for Library System
// Tracks administrative actions such as bulk issuances, batch returns, fine modifications, and book recovery.

class AuditLogger {
    constructor() {
        this.db = (typeof firebase !== 'undefined' && firebase.database) ? firebase.database() : null;
        this.auditRef = this.db ? this.db.ref('auditLogs') : null;
    }

    async log(action, category, targetId, details = {}) {
        try {
            const user = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
            const logEntry = {
                action: action || 'UNKNOWN',
                category: category || 'GENERAL',
                targetId: targetId || '',
                details: details || {},
                performedBy: user ? user.uid : 'system',
                performedByName: user ? (user.displayName || user.email || 'Admin') : 'System',
                timestamp: Date.now(),
                isoDate: new Date().toISOString()
            };

            if (this.auditRef) {
                await this.auditRef.push(logEntry);
            }
            console.log(`[AuditLogger] ${category} - ${action}:`, logEntry);
            return logEntry;
        } catch (error) {
            console.warn('[AuditLogger] Failed to record audit log:', error);
            return null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.auditLogger = new AuditLogger();
}
