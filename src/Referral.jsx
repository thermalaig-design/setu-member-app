import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User, Users, Clock, FileText, UserPlus, Bell, ChevronRight, LogOut, Heart, Shield, Plus, ArrowRight, Pill, ShoppingCart, Calendar, Stethoscope, Building2, Phone, QrCode, Monitor, Brain, Package, FileCheck, Search, Filter, MapPin, Star, HelpCircle, BookOpen, Video, Headphones, Menu, X, Home as HomeIcon, Settings, Eye, Edit2, Info, CheckCircle2, ArrowLeft } from 'lucide-react';
import { createReferral, getUserReferrals, getReferralCounts, updateReferral, deleteReferral } from './services/api';
import { supabase } from './services/supabaseClient';
import { registerSidebarState, useAndroidBack } from './hooks';

import Sidebar from './components/Sidebar';

const Referral = ({ onNavigate, referenceView, setReferenceView, newReference, setNewReference }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const mainContainerRef = useRef(null);
  const doctorPickerRef = useRef(null);
  const [referenceHistory, setReferenceHistory] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [doctorSearchTerm, setDoctorSearchTerm] = useState('');
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);
  const [counts, setCounts] = useState({ generalCount: 0, ewsCount: 0, total: 0 });
  const [selectedReferral, setSelectedReferral] = useState(null);
  const [editingReferral, setEditingReferral] = useState(null);
  const { registerBackHandler } = useAndroidBack();

  const resetNewReferralForm = useCallback(() => {
    setNewReference({
      patientName: '',
      age: '',
      gender: '',
      phone: '',
      referredTo: '',
      doctorId: null,
      doctorName: '',
      doctorDepartment: '',
      condition: '',
      category: '',
      notes: ''
    });
    setDoctorSearchTerm('');
    setShowDoctorDropdown(false);
  }, [setNewReference]);

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

  // Register sidebar state so Android back closes sidebar first.
  useEffect(() => {
    registerSidebarState(isMenuOpen, () => setIsMenuOpen(false));
  }, [isMenuOpen]);

  // Handle Android hardware back for Referral internal views before route-level back.
  useEffect(() => {
    const shouldInterceptBack = isMenuOpen || showDoctorDropdown || !!editingReferral || !!selectedReferral || referenceView === 'addNew' || referenceView === 'history';
    if (!shouldInterceptBack) return undefined;

    const unregister = registerBackHandler(() => {
      if (isMenuOpen) {
        setIsMenuOpen(false);
        return;
      }

      if (showDoctorDropdown) {
        setShowDoctorDropdown(false);
        return;
      }

      if (editingReferral) {
        setEditingReferral(null);
        if (selectedReferral) setSelectedReferral(null);
        return;
      }

      if (selectedReferral) {
        setSelectedReferral(null);
        return;
      }

      if (referenceView === 'addNew') {
        resetNewReferralForm();
        setReferenceView('menu');
        return;
      }

      if (referenceView === 'history') {
        setReferenceView('menu');
      }
    });

    return () => {
      unregister?.();
    };
  }, [isMenuOpen, showDoctorDropdown, editingReferral, selectedReferral, referenceView, resetNewReferralForm, setReferenceView]);

  // Close sidebar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMenuOpen && !event.target.closest('.absolute.left-0.top-0.bottom-0.w-72')) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('click', handleClickOutside, true);
      return () => {
        document.removeEventListener('click', handleClickOutside, true);
      };
    }
  }, [isMenuOpen]);



  // Load doctors directly from Supabase opd_schedule table
  useEffect(() => {
    const fetchDoctors = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('opd_schedule')
          .select('id, consultant_name, designation, department')
          .eq('is_active', true)
          .order('consultant_name', { ascending: true });

        if (error) throw error;

        if (data && data.length > 0) {
          const transformedDoctors = data
            .filter(doc => {
              const name = (doc.consultant_name || '').trim();
              // Skip blank names or pure-digit entries (phone numbers)
              return name.length > 0 && !/^\d+$/.test(name);
            })
            .map(doc => ({
              id: doc.id,
              name: doc.consultant_name,
              specialization: doc.designation || 'General',
              department: doc.department || 'General'
            }));
          setDoctors(transformedDoctors);
        } else {
          setDoctors([]);
        }
      } catch (error) {
        console.error('Error fetching doctors from opd_schedule:', error);
        setDoctors([]);
      } finally {
        setLoading(false);
      }
    };
    fetchDoctors();
  }, []);

  useEffect(() => {
    if (!newReference?.referredTo || doctors.length === 0) return;
    const selectedDoctor = doctors.find((doc) => String(doc.id) === String(newReference.referredTo));
    if (selectedDoctor) {
      const displayName = `${selectedDoctor.name}${selectedDoctor.department && selectedDoctor.department !== 'General' ? ` (${selectedDoctor.department})` : ''}`;
      setDoctorSearchTerm(displayName);
    }
  }, [newReference?.referredTo, doctors]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (doctorPickerRef.current && !doctorPickerRef.current.contains(event.target)) {
        setShowDoctorDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Load references from backend and counts
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [referralsRes, countsRes] = await Promise.all([
          getUserReferrals(),
          getReferralCounts()
        ]);

        if (referralsRes.success) {
          setReferenceHistory(referralsRes.referrals || []);
        }

        if (countsRes.success) {
          setCounts(countsRes.counts);
        }
      } catch (error) {
        console.error('Error loading referrals:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Refresh data after creating referral
  const refreshData = async () => {
    try {
      const [referralsRes, countsRes] = await Promise.all([
        getUserReferrals(),
        getReferralCounts()
      ]);

      if (referralsRes.success) {
        setReferenceHistory(referralsRes.referrals || []);
      }

      if (countsRes.success) {
        setCounts(countsRes.counts);
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  };

  // Handle delete referral
  const handleDeleteReferral = async (referralId) => {
    try {
      setLoading(true);
      const response = await deleteReferral(referralId);

      if (response.success) {
        alert('Referral deleted successfully!');
        await refreshData();
        if (selectedReferral?.id === referralId) {
          setSelectedReferral(null);
        }
      } else {
        alert(response.message || 'Error deleting referral');
      }
    } catch (error) {
      console.error('Error deleting referral:', error);
      const errorMsg = error.response?.data?.message || error.message || 'Error deleting referral';
      alert(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Handle update referral
  const handleUpdateReferral = async (referralId, updateData) => {
    try {
      setLoading(true);
      const response = await updateReferral(referralId, updateData);

      if (response.success) {
        alert('Referral updated successfully!');
        setEditingReferral(null);
        await refreshData();
        if (selectedReferral?.id === referralId) {
          setSelectedReferral(response.referral);
        }
      } else {
        alert(response.message || 'Error updating referral');
      }
    } catch (error) {
      console.error('Error updating referral:', error);
      const errorMsg = error.response?.data?.message || error.message || 'Error updating referral';
      alert(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const { generalCount, ewsCount, total } = counts;

  // Check if user can add more references
  const canAddReference = (category) => {
    if (total >= 4) return false;
    if (category === 'General' && generalCount >= 2) return false;
    if (category === 'EWS' && ewsCount >= 2) return false;
    return true;
  };

  const filteredDoctors = doctors.filter((doc) => {
    const term = doctorSearchTerm.trim().toLowerCase();
    if (!term) return true;
    return (
      doc.name.toLowerCase().includes(term) ||
      (doc.department || '').toLowerCase().includes(term) ||
      (doc.specialization || '').toLowerCase().includes(term)
    );
  });

  const handleDoctorSelect = (doctor) => {
    setNewReference({
      ...newReference,
      referredTo: String(doctor.id),
      doctorId: doctor.id,
      doctorName: doctor.name || '',
      doctorDepartment: doctor.department || ''
    });
    const displayName = `${doctor.name}${doctor.department && doctor.department !== 'General' ? ` (${doctor.department})` : ''}`;
    setDoctorSearchTerm(displayName);
    setShowDoctorDropdown(false);
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!newReference.category) {
      alert('Please select a category (General or EWS)');
      return;
    }

    if (!canAddReference(newReference.category)) {
      const limitMsg = newReference.category === 'General'
        ? 'You have reached the limit of 2 General category references.'
        : 'You have reached the limit of 2 EWS category references.';
      alert(limitMsg);
      return;
    }

    if (!newReference.patientName || !newReference.phone || !newReference.referredTo || !newReference.condition) {
      alert('Please fill all required fields');
      return;
    }

    try {
      setLoading(true);

      // Find selected doctor details - use doctorId if available, otherwise find by ID
      const doctorId = newReference.doctorId || parseInt(newReference.referredTo);
      const selectedDoctor = doctors.find(d => d.id === doctorId);

      if (!selectedDoctor) {
        alert('Please select a valid doctor');
        return;
      }

      const referralData = {
        patientName: newReference.patientName,
        patientAge: newReference.age || null,
        patientGender: newReference.gender || null,
        patientPhone: newReference.phone,
        category: newReference.category,
        referredToDoctor: selectedDoctor.name,
        doctorId: selectedDoctor.id,
        department: selectedDoctor.department || 'General',
        medicalCondition: newReference.condition,
        notes: newReference.notes || null
      };

      const response = await createReferral(referralData);

      if (response.success) {
        alert('Referral sent successfully');
        setNewReference({
          patientName: '',
          age: '',
          gender: '',
          phone: '',
          referredTo: '',
          doctorId: null,
          doctorName: '',
          doctorDepartment: '',
          condition: '',
          category: '',
          notes: ''
        });
        setDoctorSearchTerm('');
        setShowDoctorDropdown(false);
        setReferenceView('menu');
        // Refresh data to show new referral
        await refreshData();
      } else {
        alert(response.message || 'Error creating reference. Please try again.');
      }
    } catch (error) {
      console.error('Error creating referral:', error);
      const errorMsg = error.response?.data?.message || error.message || 'Error creating reference. Please try again.';
      alert(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={mainContainerRef}
      className={`bg-white min-h-screen pb-10 relative${isMenuOpen ? ' overflow-hidden max-h-screen' : ''}`}
    >
      {/* Navbar */}
      <div className="theme-navbar shadow-sm border-b px-4 sm:px-6 py-5 flex items-center justify-between sticky top-0 z-50 transition-all duration-300 pointer-events-auto" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}>
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="p-2 rounded-xl hover:bg-gray-100 transition-colors pointer-events-auto"
        >
          {isMenuOpen ? <X className="h-6 w-6" style={{ color: 'var(--navbar-text)' }} /> : <Menu className="h-6 w-6" style={{ color: 'var(--navbar-text)' }} />}
        </button>
        <h1 className="text-lg font-bold transition-colors" style={{ color: 'var(--navbar-text)' }}>Patient Referral</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate('home')}
            className="p-2.5 rounded-xl transition-colors hover:bg-gray-100"
            style={{ color: 'var(--navbar-text)' }}
            title="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => onNavigate('home')}
            className="p-2.5 rounded-xl transition-colors hover:bg-indigo-100"
            style={{
              border: '1px solid color-mix(in srgb, var(--navbar-text) 26%, transparent)',
              color: 'var(--navbar-text)',
              background: 'color-mix(in srgb, var(--navbar-bg) 76%, #ffffff)'
            }}
          >
            <HomeIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      <Sidebar
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onNavigate={onNavigate}
        currentPage="reference"
      />

      {referenceView === 'menu' && (
        <>
          {/* ── Top indigo hero header ── */}
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 px-5 pt-5 pb-10">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 bg-white/20 rounded-2xl flex items-center justify-center flex-shrink-0">
                <UserPlus className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Patient Referral</h1>
                <p className="text-indigo-200 text-xs font-medium">Refer patients to our specialists</p>
              </div>
            </div>

            {/* ── Compact quota bar ── */}
            <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white text-xs font-semibold">Your Referral Quota</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${total >= 4 ? 'bg-red-400/80 text-white' : 'bg-green-400/80 text-white'}`}>
                  {total >= 4 ? 'Limit Reached' : `${4 - total} left`}
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-2 bg-white/20 rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${total >= 4 ? 'bg-red-400' : 'bg-green-400'}`}
                  style={{ width: `${(total / 4) * 100}%` }}
                />
              </div>
              <div className="flex items-center gap-3 text-xs text-indigo-100 font-medium">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
                  General: {generalCount}/2
                </span>
                <span className="text-white/30">|</span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-indigo-300 inline-block" />
                  EWS: {ewsCount}/2
                </span>
                <span className="ml-auto font-bold text-white">{total}/4 used</span>
              </div>
            </div>
          </div>

          {/* ── White card pulled up over header ── */}
          <div className="bg-gray-50 rounded-t-3xl -mt-5 pt-5 px-4 min-h-screen">

            {/* ── PRIMARY CTA — New Reference ── */}
            <button
              onClick={() => setReferenceView('addNew')}
              disabled={total >= 4}
              className={`w-full rounded-3xl p-5 mb-5 transition-all active:scale-[0.97] group relative overflow-hidden shadow-xl ${total >= 4
                  ? 'bg-gray-200 border-2 border-gray-300 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                }`}
            >
              {/* subtle shimmer hint */}
              {total < 4 && (
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 -skew-x-12 animate-[shimmer_2.5s_ease-in-out_infinite]" />
              )}
              <div className="relative flex items-center gap-4">
                {/* Icon */}
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${total >= 4 ? 'bg-gray-300' : 'bg-white/20'
                  }`}>
                  <Plus className={`h-8 w-8 ${total >= 4 ? 'text-gray-500' : 'text-white'}`} />
                </div>
                {/* Text */}
                <div className="flex-1 text-left">
                  <p className={`text-lg font-extrabold leading-tight ${total >= 4 ? 'text-gray-500' : 'text-white'}`}>
                    {total >= 4 ? 'Quota Full' : 'New Reference'}
                  </p>
                  <p className={`text-xs font-medium mt-0.5 ${total >= 4 ? 'text-gray-400' : 'text-indigo-100'}`}>
                    {total >= 4 ? 'You have used all 4 referral slots' : 'Tap here to refer a patient →'}
                  </p>
                </div>
                <ChevronRight className={`h-6 w-6 flex-shrink-0 transition-transform group-hover:translate-x-1 ${total >= 4 ? 'text-gray-400' : 'text-white/70 group-hover:text-white'
                  }`} />
              </div>
            </button>

            {/* ── Reference History ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-gray-800">Reference History</h3>
                {referenceHistory.length > 0 && (
                  <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                    {referenceHistory.length} record{referenceHistory.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {loading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-600" />
                </div>
              ) : referenceHistory.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 border border-gray-100 shadow-sm text-center">
                  <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <FileText className="h-7 w-7 text-gray-300" />
                  </div>
                  <p className="font-semibold text-gray-500 text-sm">No references yet</p>
                  <p className="text-xs text-gray-400 mt-1">Tap "New Reference" above to get started</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {referenceHistory.map(ref => (
                    <div key={ref.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 group hover:shadow-md transition-all">
                      <div className="flex items-start justify-between mb-3">
                        <div
                          className="flex items-center gap-3 flex-1 cursor-pointer"
                          onClick={() => setSelectedReferral(ref)}
                        >
                          <div className={`p-2.5 rounded-xl flex-shrink-0 ${ref.category === 'EWS' ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-600'}`}>
                            <User className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              <h4 className="font-bold text-gray-800 text-sm leading-tight truncate">
                                {ref.patient_name || ref.patientName}
                              </h4>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${ref.category === 'EWS' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-700'}`}>
                                {ref.category}
                              </span>
                            </div>
                            <p className="text-gray-500 text-xs font-medium truncate">{ref.referred_to_doctor || ref.referredTo}</p>
                            {(ref.medical_condition || ref.condition) && (
                              <p className="text-gray-400 text-xs mt-0.5 line-clamp-1">{ref.medical_condition || ref.condition}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                          <span className={`text-[9px] font-bold px-2 py-1 rounded-full ${ref.status === 'Completed' ? 'bg-green-100 text-green-700' : ref.status === 'Pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
                            {ref.status}
                          </span>
                          <button onClick={(e) => { e.stopPropagation(); setEditingReferral(ref); }} className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-600 transition-colors">
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); if (confirm('Are you sure you want to delete this referral?')) { handleDeleteReferral(ref.id); } }} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-2.5 border-t border-gray-50 text-xs text-gray-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {ref.created_at ? new Date(ref.created_at).toLocaleDateString('en-IN') : (ref.date || 'N/A')}
                        </span>
                        {(ref.patient_phone || ref.phone) && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {ref.patient_phone || ref.phone}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}


      {referenceView === 'addNew' && (
        <div className="px-6 py-4">
          <button
            onClick={() => {
              resetNewReferralForm();
              setReferenceView('menu');
            }}
            className="flex items-center gap-2 text-indigo-600 font-bold text-sm mb-6 hover:underline"
          >
            <ChevronRight className="h-4 w-4 rotate-180" /> Back to Menu
          </button>

          <h2 className="text-2xl font-bold text-gray-800 mb-2">Patient Details</h2>
          <p className="text-gray-500 text-sm mb-6">Fill in the information to refer a patient</p>

          {/* Category Selection */}
          <div className="mb-6">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1 mb-3 block">Category *</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  if (canAddReference('General')) {
                    setNewReference({ ...newReference, category: 'General' });
                  } else {
                    alert('You have reached the limit of 2 General category references.');
                  }
                }}
                className={`p-4 rounded-2xl border-2 transition-all ${newReference.category === 'General'
                  ? 'border-indigo-500 bg-indigo-50'
                  : canAddReference('General')
                    ? 'border-gray-200 bg-white hover:border-gray-300'
                    : 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                  }`}
                disabled={!canAddReference('General')}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-gray-800">General</span>
                  {newReference.category === 'General' && (
                    <CheckCircle2 className="h-5 w-5 text-indigo-600" />
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Available</span>
                  <span className="text-xs font-bold text-gray-700">{2 - generalCount} left</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (canAddReference('EWS')) {
                    setNewReference({ ...newReference, category: 'EWS' });
                  } else {
                    alert('You have reached the limit of 2 EWS category references.');
                  }
                }}
                className={`p-4 rounded-2xl border-2 transition-all ${newReference.category === 'EWS'
                  ? 'border-indigo-500 bg-indigo-50'
                  : canAddReference('EWS')
                    ? 'border-gray-200 bg-white hover:border-gray-300'
                    : 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                  }`}
                disabled={!canAddReference('EWS')}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-gray-800">EWS</span>
                  {newReference.category === 'EWS' && (
                    <CheckCircle2 className="h-5 w-5 text-indigo-600" />
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Available</span>
                  <span className="text-xs font-bold text-gray-700">{2 - ewsCount} left</span>
                </div>
              </button>
            </div>
            {newReference.category && (
              <div className="mt-3 flex items-center gap-2 text-xs text-indigo-600 bg-indigo-50 px-3 py-2 rounded-xl">
                <Info className="h-4 w-4" />
                <span>Selected: <strong>{newReference.category}</strong> category</span>
              </div>
            )}
          </div>

          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Patient Name *</label>
              <input
                type="text"
                required
                value={newReference.patientName}
                onChange={(e) => setNewReference({ ...newReference, patientName: e.target.value })}
                placeholder="Enter full name"
                className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Age *</label>
                <input
                  type="number"
                  required
                  min="1"
                  max="120"
                  value={newReference.age}
                  onChange={(e) => setNewReference({ ...newReference, age: e.target.value })}
                  placeholder="Years"
                  className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Gender *</label>
                <select
                  required
                  value={newReference.gender}
                  onChange={(e) => setNewReference({ ...newReference, gender: e.target.value })}
                  className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium"
                >
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Phone Number *</label>
              <input
                type="tel"
                required
                maxLength="10"
                value={newReference.phone}
                onChange={(e) => setNewReference({ ...newReference, phone: e.target.value.replace(/\D/g, '') })}
                placeholder="10 digit number"
                className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Refer To Doctor *</label>
              <div ref={doctorPickerRef} className="relative">
                <input
                  type="text"
                  required
                  value={doctorSearchTerm}
                  onFocus={() => setShowDoctorDropdown(true)}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDoctorSearchTerm(value);
                    setShowDoctorDropdown(true);
                    setNewReference({
                      ...newReference,
                      referredTo: '',
                      doctorId: null,
                      doctorName: '',
                      doctorDepartment: ''
                    });
                  }}
                  placeholder={loading ? 'Loading doctors...' : 'Select doctor'}
                  className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium"
                  disabled={loading || doctors.length === 0}
                />
                {showDoctorDropdown && !loading && doctors.length > 0 && (
                  <div className="absolute z-30 mt-2 w-full bg-white border border-gray-200 rounded-2xl shadow-lg max-h-60 overflow-y-auto">
                    {filteredDoctors.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-500">No doctor found</div>
                    ) : (
                      filteredDoctors.slice(0, 50).map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => handleDoctorSelect(doc)}
                          className="w-full text-left px-4 py-3 hover:bg-indigo-50 transition-colors border-b last:border-b-0 border-gray-100"
                        >
                          <p className="text-sm font-semibold text-gray-800">{doc.name}</p>
                          <p className="text-xs text-gray-500">
                            {[doc.specialization, doc.department].filter(Boolean).join(' - ')}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {!loading && doctors.length === 0 && (
                <p className="text-xs text-red-500 mt-1">
                  No doctors found. Please contact admin to add doctors to the system.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Medical Condition *</label>
              <textarea
                required
                value={newReference.condition}
                onChange={(e) => setNewReference({ ...newReference, condition: e.target.value })}
                placeholder="Brief condition description"
                rows="3"
                className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={!newReference.category || !canAddReference(newReference.category) || loading}
              className={`w-full mt-6 py-4 rounded-2xl font-bold text-base shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${!newReference.category || !canAddReference(newReference.category) || loading
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'text-white btn-brand-inline hover:bg-indigo-700'
                }`}
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  Submitting...
                </>
              ) : (
                'Submit Reference'
              )}
            </button>
          </form>
        </div>
      )}

      {referenceView === 'history' && (
        <div className="px-6 py-4">
          <button
            onClick={() => setReferenceView('menu')}
            className="flex items-center gap-2 text-indigo-600 font-bold text-sm mb-6 hover:underline"
          >
            <ChevronRight className="h-4 w-4 rotate-180" /> Back to Menu
          </button>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Reference History</h2>
            <p className="text-gray-500 text-sm">
              {referenceHistory.length > 0
                ? `Total ${referenceHistory.length} reference${referenceHistory.length > 1 ? 's' : ''}`
                : 'No references yet'
              }
            </p>
          </div>

          {referenceHistory.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-8 border border-gray-200 text-center">
              <div className="bg-white p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <FileText className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">No References Yet</h3>
              <p className="text-sm text-gray-500 mb-6">Start referring patients to our specialists</p>
              <button
                onClick={() => setReferenceView('addNew')}
                className="px-6 py-3 text-white btn-brand-inline rounded-xl font-semibold hover:bg-indigo-700 transition-all"
              >
                Add New Reference
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {referenceHistory.map(ref => (
                <div key={ref.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 group hover:shadow-md hover:border-gray-300 transition-all">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4 flex-1">
                      <div className={`p-3 rounded-xl transition-colors ${ref.category === 'EWS'
                        ? 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white'
                        : 'bg-gray-100 text-gray-600 group-hover:bg-gray-600 group-hover:text-white'
                        }`}>
                        <User className="h-6 w-6" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-gray-800 text-base leading-tight">
                            {ref.patient_name || ref.patientName}
                          </h3>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${ref.category === 'EWS'
                            ? 'bg-indigo-100 text-indigo-700'
                            : 'bg-gray-100 text-gray-700'
                            }`}>
                            {ref.category}
                          </span>
                        </div>
                        <p className="text-gray-500 text-xs font-medium mt-1">
                          Referred to {ref.referred_to_doctor || ref.referredTo}
                        </p>
                        {(ref.medical_condition || ref.condition) && (
                          <p className="text-gray-400 text-xs mt-1 line-clamp-1">
                            {ref.medical_condition || ref.condition}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${ref.status === 'Completed' ? 'bg-green-100 text-green-700' :
                      ref.status === 'Pending' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                      {ref.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                    <div className="flex items-center gap-2 text-gray-500">
                      <Calendar className="h-4 w-4" />
                      <span className="text-xs font-semibold">
                        {ref.created_at ? new Date(ref.created_at).toLocaleDateString('en-IN') : (ref.date || 'N/A')}
                      </span>
                    </div>
                    {(ref.patient_phone || ref.phone) && (
                      <div className="flex items-center gap-2 text-gray-500">
                        <Phone className="h-4 w-4" />
                        <span className="text-xs font-semibold">{ref.patient_phone || ref.phone}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail View */}
      {selectedReferral && !editingReferral && (
        <div className="px-6 py-4">
          <button
            onClick={() => setSelectedReferral(null)}
            className="flex items-center gap-2 text-indigo-600 font-bold text-sm mb-6 hover:underline"
          >
            <ChevronRight className="h-4 w-4 rotate-180" /> Back to History
          </button>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Referral Details</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingReferral(selectedReferral)}
                  className="p-2 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                >
                  <Edit2 className="h-5 w-5" />
                </button>
                <button
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this referral?')) {
                      handleDeleteReferral(selectedReferral.id);
                    }
                  }}
                  className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Patient Name</label>
                  <p className="text-gray-800 font-semibold mt-1">{selectedReferral.patient_name || selectedReferral.patientName}</p>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Category</label>
                  <span className={`inline-block mt-1 px-3 py-1 rounded-full text-xs font-bold ${selectedReferral.category === 'EWS'
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-gray-100 text-gray-700'
                    }`}>
                    {selectedReferral.category}
                  </span>
                </div>
                {selectedReferral.patient_age && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Age</label>
                    <p className="text-gray-800 font-semibold mt-1">{selectedReferral.patient_age} years</p>
                  </div>
                )}
                {selectedReferral.patient_gender && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Gender</label>
                    <p className="text-gray-800 font-semibold mt-1">{selectedReferral.patient_gender}</p>
                  </div>
                )}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Phone</label>
                  <p className="text-gray-800 font-semibold mt-1">{selectedReferral.patient_phone || selectedReferral.phone}</p>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Status</label>
                  <span className={`inline-block mt-1 px-3 py-1 rounded-full text-xs font-bold ${selectedReferral.status === 'Completed' ? 'bg-green-100 text-green-700' :
                    selectedReferral.status === 'Pending' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                    {selectedReferral.status}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Referred To Doctor</label>
                <p className="text-gray-800 font-semibold mt-1">{selectedReferral.referred_to_doctor || selectedReferral.referredTo}</p>
              </div>

              {selectedReferral.department && (
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Department</label>
                  <p className="text-gray-800 font-semibold mt-1">{selectedReferral.department}</p>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Medical Condition</label>
                <p className="text-gray-800 mt-1 bg-gray-50 p-3 rounded-xl">{selectedReferral.medical_condition || selectedReferral.condition}</p>
              </div>

              {selectedReferral.notes && (
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Notes</label>
                  <p className="text-gray-800 mt-1 bg-gray-50 p-3 rounded-xl">{selectedReferral.notes}</p>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Date</label>
                <p className="text-gray-800 font-semibold mt-1">
                  {selectedReferral.created_at ? new Date(selectedReferral.created_at).toLocaleDateString('en-IN', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  }) : (selectedReferral.date || 'N/A')}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit View */}
      {editingReferral && (
        <div className="px-6 py-4">
          <button
            onClick={() => {
              setEditingReferral(null);
              if (selectedReferral) setSelectedReferral(null);
            }}
            className="flex items-center gap-2 text-indigo-600 font-bold text-sm mb-6 hover:underline"
          >
            <ChevronRight className="h-4 w-4 rotate-180" /> Back
          </button>

          <h2 className="text-2xl font-bold text-gray-800 mb-2">Edit Referral</h2>
          <p className="text-gray-500 text-sm mb-6">Update referral information</p>

          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            const updateData = {
              patientName: editingReferral.patient_name || editingReferral.patientName,
              patientAge: editingReferral.patient_age || editingReferral.age,
              patientGender: editingReferral.patient_gender || editingReferral.gender,
              patientPhone: editingReferral.patient_phone || editingReferral.phone,
              category: editingReferral.category,
              referredToDoctor: editingReferral.referred_to_doctor || editingReferral.referredTo,
              doctorId: editingReferral.doctor_id || editingReferral.doctorId,
              department: editingReferral.department,
              medicalCondition: editingReferral.medical_condition || editingReferral.condition,
              notes: editingReferral.notes || ''
            };
            handleUpdateReferral(editingReferral.id, updateData);
          }}>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Patient Name *</label>
              <input
                type="text"
                required
                value={editingReferral.patient_name || editingReferral.patientName || ''}
                onChange={(e) => setEditingReferral({ ...editingReferral, patient_name: e.target.value })}
                className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Age</label>
                <input
                  type="number"
                  value={editingReferral.patient_age || editingReferral.age || ''}
                  onChange={(e) => setEditingReferral({ ...editingReferral, patient_age: e.target.value })}
                  className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Gender</label>
                <select
                  value={editingReferral.patient_gender || editingReferral.gender || ''}
                  onChange={(e) => setEditingReferral({ ...editingReferral, patient_gender: e.target.value })}
                  className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium"
                >
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Phone Number *</label>
              <input
                type="tel"
                required
                value={editingReferral.patient_phone || editingReferral.phone || ''}
                onChange={(e) => setEditingReferral({ ...editingReferral, patient_phone: e.target.value.replace(/\D/g, '') })}
                className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Refer To Doctor *</label>
              <select
                required
                value={editingReferral.doctor_id || editingReferral.doctorId || ''}
                onChange={(e) => {
                  const doctorId = parseInt(e.target.value);
                  const selectedDoctor = doctors.find(d => d.id === doctorId);
                  setEditingReferral({
                    ...editingReferral,
                    doctor_id: doctorId,
                    referred_to_doctor: selectedDoctor?.name || editingReferral.referred_to_doctor,
                    department: selectedDoctor?.department || editingReferral.department
                  });
                }}
                className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium"
                disabled={loading && doctors.length === 0} // Disable while loading and no doctors available
              >
                {loading && doctors.length === 0 ? (
                  <option value="">Loading doctors...</option>
                ) : doctors.length === 0 ? (
                  <option value="">No doctors available</option>
                ) : (
                  <>
                    <option value="">Choose doctor</option>
                    {doctors.map(doc => (
                      <option key={doc.id} value={doc.id}>
                        {doc.name} - {doc.specialization} ({doc.department})
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Medical Condition *</label>
              <textarea
                required
                value={editingReferral.medical_condition || editingReferral.condition || ''}
                onChange={(e) => setEditingReferral({ ...editingReferral, medical_condition: e.target.value })}
                rows="3"
                className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Notes</label>
              <textarea
                value={editingReferral.notes || ''}
                onChange={(e) => setEditingReferral({ ...editingReferral, notes: e.target.value })}
                rows="2"
                className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:border-indigo-500 transition-all text-sm font-medium resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full mt-6 py-4 rounded-2xl font-bold text-base shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${loading
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'text-white btn-brand-inline hover:bg-indigo-700'
                }`}
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  Updating...
                </>
              ) : (
                'Update Referral'
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default Referral;
