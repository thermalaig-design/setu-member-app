import React, { useState, useEffect, useRef } from 'react';
import { FileText, Plus, Calendar, Download, X, Home as HomeIcon, ChevronLeft, Upload, CheckCircle, AlertCircle, Image as ImageIcon, File, Menu } from 'lucide-react';
import Sidebar from './components/Sidebar';
import { getUserReports, uploadUserReport } from './services/api';

const Reports = ({ onNavigate }) => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    reportName: '',
    reportType: '',
    testDate: '',
    file: null
  });
  const [filePreview, setFilePreview] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const mainContainerRef = useRef(null);

  // Scroll locking when sidebar is open
  useEffect(() => {
    if (isMenuOpen) {
      const scrollY = window.scrollY;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.touchAction = 'none';
    } else {
      const scrollY = parseInt(document.body.style.top || '0') * -1;
      document.documentElement.style.overflow = 'unset';
      document.body.style.overflow = 'unset';
      document.body.style.position = 'unset';
      document.body.style.width = 'unset';
      document.body.style.top = 'unset';
      document.body.style.touchAction = 'auto';
      window.scrollTo(0, scrollY);
    }
    return () => {
      document.documentElement.style.overflow = 'unset';
      document.body.style.overflow = 'unset';
      document.body.style.position = 'unset';
      document.body.style.width = 'unset';
      document.body.style.top = 'unset';
      document.body.style.touchAction = 'auto';
      document.body.style.pointerEvents = 'auto';
    };
  }, [isMenuOpen]);

  // Close sidebar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMenuOpen && mainContainerRef.current) {
        // Check if click is outside the sidebar (overlay backdrop click)
        const sidebar = mainContainerRef.current.querySelector('[z-50]') || mainContainerRef.current.querySelector('.absolute.left-0');
        if (!sidebar || !event.target.closest('.absolute.left-0.top-0.bottom-0.w-72')) {
          // Clicked outside sidebar, close it
          setIsMenuOpen(false);
        }
      }
    };

    if (isMenuOpen) {
      document.addEventListener('click', handleClickOutside, true);
      return () => {
        document.removeEventListener('click', handleClickOutside, true);
      };
    }
  }, [isMenuOpen]);

  // Fetch reports on mount
  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      setLoading(true);

      const data = await getUserReports();

      if (data.success) {
        setReports(data.reports || []);
      } else {
        setError(data.message || 'Failed to load reports');
      }
    } catch (error) {
      console.error('Error fetching reports:', error);
      setError('Failed to load reports. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
      if (!allowedTypes.includes(file.type)) {
        setError('Invalid file type. Please upload PDF, JPG, or PNG files only.');
        return;
      }

      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        setError('File size too large. Maximum size is 10MB.');
        return;
      }

      setUploadForm({ ...uploadForm, file });
      setError(null);

      // Create preview for images
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setFilePreview(reader.result);
        };
        reader.readAsDataURL(file);
      } else {
        setFilePreview(null);
      }
    }
  };

  const handleUpload = async () => {
    // Validation
    if (!uploadForm.reportName.trim()) {
      setError('Please enter report name');
      return;
    }
    if (!uploadForm.reportType) {
      setError('Please select report type');
      return;
    }
    if (!uploadForm.testDate) {
      setError('Please select test date');
      return;
    }
    if (!uploadForm.file) {
      setError('Please select a file to upload');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const reportData = {
        reportName: uploadForm.reportName.trim(),
        reportType: uploadForm.reportType,
        testDate: uploadForm.testDate
      };

      const data = await uploadUserReport(reportData, uploadForm.file);

      if (data.success) {
        setSuccess('Report uploaded successfully!');
        setUploadForm({ reportName: '', reportType: '', testDate: '', file: null });
        setFilePreview(null);
        setShowUploadForm(false);
        // Reset file input
        const fileInput = document.getElementById('report-upload');
        if (fileInput) fileInput.value = '';

        // Refresh reports list
        setTimeout(() => {
          fetchReports();
          setSuccess(null);
        }, 1000);
      } else {
        setError(data.message || 'Upload failed. Please try again.');
      }
    } catch (error) {
      console.error('Upload error:', error);
      setError('Upload failed. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  const getFileIcon = (fileUrl) => {
    if (!fileUrl) return <FileText className="h-6 w-6" />;
    const extension = fileUrl.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png'].includes(extension)) {
      return <ImageIcon className="h-6 w-6" />;
    }
    return <File className="h-6 w-6" />;
  };

  return (
    <div
      ref={mainContainerRef}
      className={`bg-white min-h-screen pb-10 relative${isMenuOpen ? ' overflow-hidden max-h-screen' : ''}`}
    >
      {/* Navbar */}
      <div className="theme-navbar shadow-sm border-b px-6 py-5 flex items-center justify-between sticky top-0 z-50 transition-all duration-300 pointer-events-auto" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}>
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="p-2 rounded-xl hover:bg-gray-100 transition-colors pointer-events-auto"
        >
          {isMenuOpen ? <X className="h-6 w-6" style={{ color: 'var(--navbar-text)' }} /> : <Menu className="h-6 w-6" style={{ color: 'var(--navbar-text)' }} />}
        </button>
        <h1 className="text-lg font-bold transition-colors" style={{ color: 'var(--navbar-text)' }}>My Reports</h1>
        <button
          onClick={() => onNavigate('home')}
          className="p-2 rounded-xl transition-colors flex items-center justify-center hover:bg-gray-100" style={{ color: 'var(--navbar-text)' }}
        >
          <HomeIcon className="h-5 w-5" />
        </button>
      </div>

      <Sidebar
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onNavigate={onNavigate}
        currentPage="reports"
      />

      {/* Header Section */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-4">
          <div className="bg-indigo-50 p-3 rounded-2xl">
            <FileText className="h-8 w-8 theme-primary-icon" style={{ color: "var(--brand-navy)" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Medical Reports</h1>
            <p className="text-gray-500 text-sm mt-1">View and manage your test reports</p>
          </div>
        </div>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="px-6 mt-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <p className="text-green-700 text-sm font-medium">{success}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="px-6 mt-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <p className="text-red-700 text-sm font-medium">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto"
            >
              <X className="h-4 w-4 text-red-600" />
            </button>
          </div>
        </div>
      )}

      {/* Upload Button */}
      {!showUploadForm && (
        <div className="px-6 mt-4">
          <button
            onClick={() => setShowUploadForm(true)}
            className="w-full text-white py-3.5 rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 btn-brand"
          >
            <Plus className="h-5 w-5" />
            Upload New Report
          </button>
        </div>
      )}

      {/* Upload Form */}
      {showUploadForm && (
        <div className="px-6 mt-4">
          <div className="bg-gray-50 rounded-2xl p-5 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800">Upload Report</h2>
              <button
                onClick={() => {
                  setShowUploadForm(false);
                  setUploadForm({ reportName: '', reportType: '', testDate: '', file: null });
                  setFilePreview(null);
                  setError(null);
                  const fileInput = document.getElementById('report-upload');
                  if (fileInput) fileInput.value = '';
                }}
                className="p-1 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Report Name */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Report Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g., Blood Test Report"
                  value={uploadForm.reportName}
                  onChange={(e) => setUploadForm({ ...uploadForm, reportName: e.target.value })}
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-sm"
                />
              </div>

              {/* Report Type */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Report Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={uploadForm.reportType}
                  onChange={(e) => setUploadForm({ ...uploadForm, reportType: e.target.value })}
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-xl text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-sm"
                >
                  <option value="">Select type</option>
                  <option value="Pathology">Pathology</option>
                  <option value="Radiology">Radiology</option>
                  <option value="Cardiology">Cardiology</option>
                  <option value="Blood Test">Blood Test</option>
                  <option value="X-Ray">X-Ray</option>
                  <option value="MRI">MRI</option>
                  <option value="CT Scan">CT Scan</option>
                  <option value="Ultrasound">Ultrasound</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Test Date */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Test Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={uploadForm.testDate}
                  onChange={(e) => setUploadForm({ ...uploadForm, testDate: e.target.value })}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-xl text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-sm"
                />
              </div>

              {/* File Upload */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Upload File <span className="text-red-500">*</span>
                </label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFileChange}
                  className="hidden"
                  id="report-upload"
                />
                <label
                  htmlFor="report-upload"
                  className="flex flex-col items-center justify-center gap-2 w-full px-4 py-6 bg-white border-2 border-dashed border-gray-300 rounded-xl text-gray-600 hover:border-indigo-400 hover:bg-indigo-50 transition-all cursor-pointer"
                >
                  {filePreview ? (
                    <img src={filePreview} alt="Preview" className="max-h-32 rounded-lg" />
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-gray-400" />
                      <span className="text-sm font-medium">Choose File</span>
                      <span className="text-xs text-gray-500">PDF, JPG, PNG (Max 10MB)</span>
                    </>
                  )}
                </label>
                {uploadForm.file && (
                  <p className="mt-2 text-xs text-gray-600">
                    Selected: {uploadForm.file.name} ({(uploadForm.file.size / 1024 / 1024).toFixed(2)} MB)
                  </p>
                )}
              </div>

              {/* Upload Button */}
              <button
                onClick={handleUpload}
                disabled={loading}
                className="w-full text-white py-3.5 rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed btn-brand"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5" />
                    Upload Report
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reports List */}
      <div className="px-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">My Reports ({reports.length})</h2>
        </div>

        {loading && reports.length === 0 ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-t-transparent mx-auto" style={{ borderColor: 'var(--brand-navy)', borderTopColor: 'transparent' }}></div>
            <p className="text-gray-500 text-sm mt-4">Loading reports...</p>
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-300">
            <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-gray-800 font-bold text-lg mb-2">No reports yet</h3>
            <p className="text-gray-500 text-sm mb-4">Upload your first medical report to get started</p>
            <button
              onClick={() => setShowUploadForm(true)}
              className="text-white px-6 py-2 rounded-xl font-semibold text-sm transition-all btn-brand"
            >
              Upload Report
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <div
                key={report.id}
                className="bg-white rounded-xl p-4 border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className="bg-indigo-50 p-3 rounded-xl">
                    {getFileIcon(report.file_url)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-800 text-base mb-1 truncate">
                      {report.report_name}
                    </h3>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="bg-gray-100 text-gray-700 text-xs font-semibold px-2 py-1 rounded-lg">
                        {report.report_type || 'N/A'}
                      </span>
                      <div className="flex items-center gap-1 text-gray-500 text-xs">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>{formatDate(report.test_date)}</span>
                      </div>
                    </div>
                  </div>
                  <a
                    href={report.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white p-2.5 rounded-xl transition-all flex-shrink-0 btn-brand"
                  >
                    <Download className="h-5 w-5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Extra Space */}
      <div className="h-10"></div>
    </div>
  );
};

export default Reports;
