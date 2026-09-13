class StudentBulkImporter {
    constructor() {
        this.setupListeners();
        this.importedData = [];
    }

    setupListeners() {
        const bulkBtn = document.getElementById('bulkImportStudentsBtn');
        const fileInput = document.getElementById('bulkStudentFile');
        const downloadBtn = document.getElementById('downloadStudentTemplate');
        const confirmBtn = document.getElementById('confirmStudentImport');

        if (bulkBtn) {
            bulkBtn.addEventListener('click', () => this.showModal());
        }

        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        if (downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.downloadTemplate();
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.processImport());
        }
    }

    showModal() {
        const modal = new bootstrap.Modal(document.getElementById('bulkStudentModal'));
        document.getElementById('bulkStudentFile').value = '';
        document.getElementById('importPreview').style.display = 'none';
        this.importedData = [];
        modal.show();
    }

    downloadTemplate() {
        const XLSX = window.XLSX;
        if (!XLSX) {
            Swal.fire('Error', 'Excel library not loaded', 'error');
            return;
        }

        const templateData = [
            ['Assessment No.', 'Full Name', 'Gender', 'Birth Cert No.', 'DoB', 'Nationality', 'Phone Number', 'Low vision', 'Blind', 'Deaf', 'Physical D'],
            ['B006678977', 'OBAJE SAMWEL OCHOLA', 'M', '0431520501', '23/07/2015', 'Citizen', '0712345678', '', '', '', ''],
            ['B006679146', 'OGUTU MERYL AWUOR', 'F', '000000000', '25/01/2014', 'Citizen', '0712345679', '', '', '', ''],
            ['B006679156', 'OCHIENG BRONIAH JOY AKINYI', 'F', '0431984062', '16/09/2016', 'Citizen', '0712345680', '', '', '', '']
        ];

        const ws = XLSX.utils.aoa_to_sheet(templateData);
        ws['!cols'] = [
            { wch: 16 },  // Assessment No.
            { wch: 25 },  // Full Name
            { wch: 10 },  // Gender
            { wch: 15 },  // Birth Cert No.
            { wch: 12 },  // DoB
            { wch: 12 },  // Nationality
            { wch: 14 },  // Phone Number
            { wch: 12 },  // Low vision
            { wch: 10 },  // Blind
            { wch: 10 },  // Deaf
            { wch: 12 }   // Physical D
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Students');
        XLSX.writeFile(wb, 'student_import_template.xlsx');
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const XLSX = window.XLSX;
                if (!XLSX) {
                    Swal.fire('Error', 'Excel library not loaded', 'error');
                    return;
                }

                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                if (jsonData.length === 0) {
                    Swal.fire('Error', 'No data found in Excel file', 'error');
                    this.importedData = [];
                    return;
                }

                // Validate headers (case-insensitive) - Assessment No. and Full Name are required
                const firstRow = jsonData[0];
                const headerKeys = Object.keys(firstRow).map(k => k.toLowerCase());
                
                const hasAssessmentNo = headerKeys.some(k => k.includes('assessment') && k.includes('no'));
                const hasFullName = headerKeys.some(k => k.includes('full') && k.includes('name') || k === 'name');

                if (!hasAssessmentNo || !hasFullName) {
                    Swal.fire('Error', 'Excel file must contain: Assessment No. and Full Name columns', 'error');
                    this.importedData = [];
                    return;
                }

                this.importedData = jsonData;
                this.showPreview(jsonData.slice(0, 5));
                
                Swal.fire('Success', `Found ${jsonData.length} students to import`, 'success');
            } catch (error) {
                console.error('Error reading file:', error);
                Swal.fire('Error', 'Failed to read Excel file. Make sure it\'s a valid .xlsx or .csv file', 'error');
                this.importedData = [];
            }
        };
        reader.readAsArrayBuffer(file);
    }

    showPreview(data) {
        const previewHead = document.getElementById('previewHead');
        const previewBody = document.getElementById('previewBody');
        const importPreview = document.getElementById('importPreview');

        if (data.length === 0) return;

        const headers = Object.keys(data[0]);
        previewHead.innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
        
        previewBody.innerHTML = data.map(row => 
            `<tr>${headers.map(h => `<td>${row[h] || '-'}</td>`).join('')}</tr>`
        ).join('');

        importPreview.style.display = 'block';
    }

    async processImport() {
        if (this.importedData.length === 0) {
            Swal.fire('Error', 'No data to import. Please select a file first.', 'error');
            return;
        }

        Swal.fire({
            title: 'Importing Students...',
            html: 'Please wait while students are being imported.',
            icon: 'info',
            allowOutsideClick: false,
            allowEscapeKey: false,
            didOpen: async () => {
                Swal.showLoading();
                await this.importStudents();
            }
        });
    }

    async importStudents() {
        try {
            let successCount = 0;
            let errorCount = 0;
            const errors = [];

            for (const row of this.importedData) {
                try {
                    // Normalize field names (case-insensitive) - flexible matching
                    const getFieldValue = (fieldPatterns) => {
                        if (typeof fieldPatterns === 'string') {
                            fieldPatterns = [fieldPatterns];
                        }
                        const entry = Object.entries(row).find(([key]) => 
                            fieldPatterns.some(pattern => key.toLowerCase().includes(pattern.toLowerCase()))
                        );
                        return entry ? entry[1] : '';
                    };

                    const assessmentNo = getFieldValue(['assessment', 'no.', 'no']);
                    const fullName = getFieldValue(['full name', 'name']);
                    const gender = getFieldValue('gender');
                    const birthCertNo = getFieldValue(['birth cert', 'birth certificate']);
                    const dob = getFieldValue(['dob', 'date of birth', 'birth date']);
                    const nationality = getFieldValue('nationality');
                    const phoneNumber = getFieldValue(['phone', 'phone number', 'contact']);
                    const lowVision = getFieldValue('low vision') ? true : false;
                    const blind = getFieldValue('blind') ? true : false;
                    const deaf = getFieldValue('deaf') ? true : false;
                    const physicalDisability = getFieldValue(['physical d', 'physical disability']);

                    if (!assessmentNo || !fullName) {
                        errorCount++;
                        errors.push(`Row skipped: Missing Assessment No. or Full Name`);
                        continue;
                    }

                    // Add student to Firebase
                    const studentData = {
                        assessmentNo: assessmentNo.toString().trim(),
                        fullName: fullName.toString().trim(),
                        gender: gender ? gender.toString().trim() : '',
                        birthCertNo: birthCertNo ? birthCertNo.toString().trim() : '',
                        dob: dob ? dob.toString().trim() : '',
                        nationality: nationality ? nationality.toString().trim() : '',
                        phoneNumber: phoneNumber ? phoneNumber.toString().trim() : '',
                        lowVision: lowVision,
                        blind: blind,
                        deaf: deaf,
                        physicalDisability: physicalDisability ? physicalDisability.toString().trim() : '',
                        timestamp: Date.now()
                    };

                    const newStudentRef = db.ref('students').push();
                    await newStudentRef.set(studentData);
                    successCount++;

                } catch (error) {
                    errorCount++;
                    errors.push(`Error: ${error.message}`);
                }
            }

            // Refresh student list
            if (window.studentManager) {
                await window.studentManager.loadStudents();
            }

            // Close modal
            const modalEl = document.getElementById('bulkStudentModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            // Show result
            Swal.fire({
                title: 'Import Complete',
                html: `
                    <div style="text-align: left;">
                        <p><strong style="color: #27ae60;">✅ Imported:</strong> ${successCount} students</p>
                        ${errorCount > 0 ? `<p><strong style="color: #e74c3c;">❌ Errors:</strong> ${errorCount}</p>` : ''}
                        ${errors.length > 0 && errors.length <= 5 ? `<p style="font-size: 12px; color: #555; margin-top: 10px;">${errors.join('<br>')}</p>` : ''}
                    </div>
                `,
                icon: successCount > 0 ? 'success' : 'warning'
            });

            this.importedData = [];

        } catch (error) {
            console.error('Import error:', error);
            Swal.fire('Error', 'Failed to import students: ' + error.message, 'error');
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.studentBulkImporter = new StudentBulkImporter();
});
