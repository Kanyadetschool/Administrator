/**
 * Advanced Filtering System for Reports
 * Allows users to create custom report filters
 */

class AdvancedFilter {
    constructor() {
        this.filters = [];
        this.activeFilters = [];
    }

    /**
     * Add a filter condition
     */
    addFilter(field, operator, value) {
        this.activeFilters.push({
            field: field,
            operator: operator,  // 'equals', 'contains', 'gt', 'lt', 'between', 'in'
            value: value,
            id: Date.now()
        });
        return this;
    }

    /**
     * Clear all filters
     */
    clearFilters() {
        this.activeFilters = [];
        return this;
    }

    /**
     * Remove a specific filter
     */
    removeFilter(filterId) {
        this.activeFilters = this.activeFilters.filter(f => f.id !== filterId);
        return this;
    }

    /**
     * Apply filters to array of objects
     */
    applyFilters(data) {
        if (this.activeFilters.length === 0) return data;

        return data.filter(item => {
            return this.activeFilters.every(filter => this.evaluateFilter(item, filter));
        });
    }

    /**
     * Evaluate a single filter condition
     */
    evaluateFilter(item, filter) {
        const value = this.getNestedValue(item, filter.field);

        switch (filter.operator) {
            case 'equals':
                return value === filter.value;

            case 'not_equals':
                return value !== filter.value;

            case 'contains':
                return String(value).toLowerCase().includes(String(filter.value).toLowerCase());

            case 'not_contains':
                return !String(value).toLowerCase().includes(String(filter.value).toLowerCase());

            case 'gt':
                return Number(value) > Number(filter.value);

            case 'gte':
                return Number(value) >= Number(filter.value);

            case 'lt':
                return Number(value) < Number(filter.value);

            case 'lte':
                return Number(value) <= Number(filter.value);

            case 'between':
                return Number(value) >= Number(filter.value[0]) && Number(value) <= Number(filter.value[1]);

            case 'in':
                return Array.isArray(filter.value) && filter.value.includes(value);

            case 'not_in':
                return Array.isArray(filter.value) && !filter.value.includes(value);

            case 'starts_with':
                return String(value).toLowerCase().startsWith(String(filter.value).toLowerCase());

            case 'ends_with':
                return String(value).toLowerCase().endsWith(String(filter.value).toLowerCase());

            case 'is_empty':
                return !value || value === '';

            case 'is_not_empty':
                return value && value !== '';

            default:
                return true;
        }
    }

    /**
     * Get nested property value (e.g., 'student.grade')
     */
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, prop) => current?.[prop], obj);
    }

    /**
     * Sort filtered data
     */
    sort(data, field, ascending = true) {
        return [...data].sort((a, b) => {
            const aVal = this.getNestedValue(a, field);
            const bVal = this.getNestedValue(b, field);

            if (aVal < bVal) return ascending ? -1 : 1;
            if (aVal > bVal) return ascending ? 1 : -1;
            return 0;
        });
    }

    /**
     * Group filtered data
     */
    group(data, field) {
        return data.reduce((groups, item) => {
            const groupKey = this.getNestedValue(item, field);
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(item);
            return groups;
        }, {});
    }

    /**
     * Get filter summary
     */
    getFilterSummary() {
        return this.activeFilters.map(f => `${f.field} ${f.operator} ${JSON.stringify(f.value)}`).join(' AND ');
    }

    /**
     * Get statistics for filtered data
     */
    getStatistics(data, field) {
        const values = data.map(item => {
            const val = this.getNestedValue(item, field);
            return isNaN(val) ? 0 : Number(val);
        });

        return {
            count: values.length,
            sum: values.reduce((a, b) => a + b, 0),
            average: values.reduce((a, b) => a + b, 0) / values.length,
            min: Math.min(...values),
            max: Math.max(...values),
            median: this.getMedian(values)
        };
    }

    /**
     * Calculate median
     */
    getMedian(values) {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    /**
     * Export filtered data to CSV
     */
    exportToCSV(data, filename = 'report.csv') {
        if (data.length === 0) {
            toast.warning('No data to export');
            return;
        }

        // Get all keys from first object
        const keys = Object.keys(data[0]);

        let csv = keys.join(',') + '\n';

        data.forEach(item => {
            const values = keys.map(key => {
                let value = item[key];
                if (typeof value === 'object') {
                    value = JSON.stringify(value);
                }
                // Escape quotes
                value = String(value).replace(/"/g, '""');
                return `"${value}"`;
            });
            csv += values.join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast.success('Data exported successfully');
    }
}

/**
 * Pagination Helper
 */
class Pagination {
    constructor(data, pageSize = 50) {
        this.data = data;
        this.pageSize = pageSize;
        this.currentPage = 1;
    }

    /**
     * Get current page data
     */
    getPage(pageNumber = this.currentPage) {
        this.currentPage = pageNumber;
        const start = (pageNumber - 1) * this.pageSize;
        return {
            data: this.data.slice(start, start + this.pageSize),
            pageNumber: pageNumber,
            pageSize: this.pageSize,
            total: this.data.length,
            totalPages: Math.ceil(this.data.length / this.pageSize)
        };
    }

    /**
     * Get next page
     */
    nextPage() {
        const totalPages = Math.ceil(this.data.length / this.pageSize);
        if (this.currentPage < totalPages) {
            return this.getPage(this.currentPage + 1);
        }
        return this.getPage(this.currentPage);
    }

    /**
     * Get previous page
     */
    previousPage() {
        if (this.currentPage > 1) {
            return this.getPage(this.currentPage - 1);
        }
        return this.getPage(this.currentPage);
    }

    /**
     * Change page size
     */
    setPageSize(newSize) {
        this.pageSize = newSize;
        this.currentPage = 1;
        return this.getPage(1);
    }

    /**
     * Get page range for pagination controls
     */
    getPageRange(windowSize = 5) {
        const totalPages = Math.ceil(this.data.length / this.pageSize);
        const start = Math.max(1, this.currentPage - Math.floor(windowSize / 2));
        const end = Math.min(totalPages, start + windowSize - 1);
        
        const pages = [];
        for (let i = start; i <= end; i++) {
            pages.push(i);
        }
        return pages;
    }
}

/**
 * Report Builder
 */
class ReportBuilder {
    constructor(name) {
        this.name = name;
        this.data = [];
        this.filters = new AdvancedFilter();
        this.pagination = null;
        this.sortField = null;
        this.sortAscending = true;
    }

    /**
     * Set source data
     */
    setData(data) {
        this.data = data;
        this.pagination = new Pagination(data);
        return this;
    }

    /**
     * Add filter
     */
    addFilter(field, operator, value) {
        this.filters.addFilter(field, operator, value);
        return this;
    }

    /**
     * Set sorting
     */
    setSort(field, ascending = true) {
        this.sortField = field;
        this.sortAscending = ascending;
        return this;
    }

    /**
     * Build and return filtered data
     */
    build() {
        let result = this.filters.applyFilters(this.data);

        if (this.sortField) {
            result = this.filters.sort(result, this.sortField, this.sortAscending);
        }

        return result;
    }

    /**
     * Get paginated results
     */
    getPagedResults(pageNumber = 1, pageSize = 50) {
        this.pagination = new Pagination(this.build(), pageSize);
        return this.pagination.getPage(pageNumber);
    }

    /**
     * Get summary statistics
     */
    getSummary(numericalField) {
        const data = this.build();
        return {
            totalRecords: data.length,
            statistics: this.filters.getStatistics(data, numericalField),
            filterSummary: this.filters.getFilterSummary()
        };
    }
}

// Create global instance
const advancedFilter = new AdvancedFilter();
const reportBuilder = ReportBuilder;

window.AdvancedFilter = AdvancedFilter;
window.Pagination = Pagination;
window.ReportBuilder = ReportBuilder;
window.advancedFilter = advancedFilter;
