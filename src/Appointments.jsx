import React, { useState, useEffect, useRef } from 'react';
import { User, Phone, Menu, X, Calendar, Stethoscope, Home as HomeIcon, Mail, AlertCircle, Clock, ArrowLeft, ChevronRight, Star, MapPin, IndianRupee, Award, History, CheckCircle2, XCircle, RefreshCw, Trash2 } from 'lucide-react';

import { getDoctorsWithSchedule } from './services/supabaseService';
import { bookAppointment } from './services/appointmentService';
import { supabase } from './services/supabaseClient';
import Sidebar from './components/Sidebar';
import { registerSidebarState, useAndroidBack } from './hooks';
import { useAppTheme } from './context/ThemeContext';

// Specialty ID â†’ department keyword mapping (matches opd_schedule.department)
// Keywords are matched using .toLowerCase().includes() against doctor's department field
const SPECIALTY_DEPT_MAP = {
  medicine: 'medicine',
  child: 'paediatric',
  pediatric_cardio: 'paediatrics-cardiology',
  pediatric_rheum: 'paediatrics- rheum',
  oncology: 'oncology',
  surgery: 'Surgery',
  bariatric: 'Bariatric Surgery',
  gynae: 'gynaecolog',
  family: 'family medicine',
  fetal: 'fetal',
  ortho: 'orthopaedics',
  eye: 'ophthalmology',
  cardiology: 'cardiology',
  cardiac_bypass: 'cardiac-bypass',
  haematology: 'haematology',
  ent: 'ent',
  cochlear: 'cochlear',
  urology: 'urology',
  nephro: 'nephrologist',
  ctvs: 'ctvs',
  neurology: 'neurology',
  neurosurgery: 'neuro- surgery',
  spine: 'spine opd',
  resp: 'resp. medicine',
  gastro: 'gastro',
  endo: 'endocrin',
  endo_surg: 'endocrine-surgery',
  rheum: 'rheumatology',
  plastic: 'pl sug',
  paed_surg: 'paed-surgery',
  psychiatry: 'psychiatry',
  skin: 'skin',
  pain: 'pain management',
  pathology: 'pathology',
  hemato_path: 'hemato pathology',
  micro: 'microbiology',
  biochem: 'bio-chemistry',
  radiology: 'radiology',
  anaesthesia: 'anaesthesia',
  cardiac_anaes: 'cardiac anaesthetist',
  blood_bank: 'blood bank',
  critical: 'critical care',
  psychology: 'clinical psychologist',
  emeritus_surg: 'emeritus - surgery',
  emeritus_paed: 'emeritus -paediatrics',
  ent_courtesy: 'ent - courtesy',
  audiologist: 'audiologist',
  lactation: 'lactation',
  dietician: 'dietician',
  dental: 'endodontist|prosthodontic|oral medicine|oral & maxillofacial|implantologist|cosmetic dentist|rct specialist|orthodontist|periodontist',
  other: '',
};

const SPECIALTIES = [
  // ─── Core Clinical ───────────────────────────────────────────────────────────
  { id: 'medicine', label: 'General Medicine', emoji: '🩺', bg: 'bg-blue-50', symptoms: ['fever', 'cold', 'body pain', 'weakness', 'headache', 'fatigue', 'general checkup', 'flu', 'medicine', 'physician'] },
  { id: 'child', label: 'Paediatrics', emoji: '👶', bg: 'bg-pink-50', symptoms: ['child', 'baby', 'infant', 'pediatric', 'kids', 'newborn', 'vaccination', 'child fever'] },
  { id: 'gynae', label: 'Gynaecology', emoji: '🤰', bg: 'bg-rose-50', symptoms: ['period', 'pregnancy', 'pcod', 'pcos', 'menstrual', 'gynecology', 'fertility', 'women health'] },
  { id: 'surgery', label: 'Surgery', emoji: '🏥', bg: 'bg-indigo-50', symptoms: ['surgery', 'hernia', 'appendix', 'operation', 'abscess', 'wound', 'surgical'] },
  { id: 'ortho', label: 'Orthopaedics', emoji: '🦴', bg: 'bg-amber-50', symptoms: ['joint pain', 'knee pain', 'back pain', 'fracture', 'arthritis', 'bone', 'spine', 'shoulder pain', 'orthopedic'] },
  { id: 'cardiology', label: 'Cardiology', emoji: '❤️', bg: 'bg-red-50', symptoms: ['chest pain', 'heart', 'palpitation', 'high BP', 'hypertension', 'cardiac', 'shortness of breath'] },
  { id: 'neurology', label: 'Neurology', emoji: '🧬', bg: 'bg-violet-50', symptoms: ['headache', 'migraine', 'seizure', 'epilepsy', 'nerve pain', 'stroke', 'memory loss', 'dizziness', 'neurology'] },
  { id: 'neurosurgery', label: 'Neuro Surgery', emoji: '🔬', bg: 'bg-purple-50', symptoms: ['brain surgery', 'neuro surgery', 'spine surgery', 'tumor brain'] },
  { id: 'eye', label: 'Ophthalmology', emoji: '👁', bg: 'bg-cyan-50', symptoms: ['eye pain', 'blurred vision', 'glasses', 'cataract', 'eye redness', 'vision', 'ophthalmology', 'retina'] },
  { id: 'ent', label: 'ENT', emoji: '👂', bg: 'bg-orange-50', symptoms: ['ear pain', 'hearing loss', 'sinus', 'nose bleed', 'tonsil', 'snoring', 'throat pain', 'ent', 'cochlear'] },
  { id: 'skin', label: 'Skin & VD', emoji: '✨', bg: 'bg-yellow-50', symptoms: ['acne', 'rash', 'hair fall', 'itching', 'eczema', 'skin allergy', 'psoriasis', 'dermatology'] },
  { id: 'psychiatry', label: 'Psychiatry', emoji: '🧠', bg: 'bg-fuchsia-50', symptoms: ['anxiety', 'depression', 'stress', 'mood', 'insomnia', 'sleep disorder', 'mental health', 'panic', 'psychiatry'] },
  { id: 'urology', label: 'Urology', emoji: '💧', bg: 'bg-blue-50', symptoms: ['urine problem', 'kidney stone', 'UTI', 'urinary', 'prostate', 'urology', 'bladder'] },
  { id: 'nephro', label: 'Nephrology', emoji: '🩺', bg: 'bg-sky-50', symptoms: ['kidney', 'dialysis', 'renal', 'nephrology', 'urine infection'] },
  { id: 'gastro', label: 'Gastro & GI', emoji: '🍽️', bg: 'bg-green-50', symptoms: ['stomach pain', 'acidity', 'bloating', 'constipation', 'diarrhea', 'gas', 'digestion', 'vomiting', 'gastro', 'liver'] },
  { id: 'resp', label: 'Resp. Medicine', emoji: '🫁', bg: 'bg-sky-50', symptoms: ['breathing problem', 'asthma', 'cough', 'lung', 'COPD', 'TB', 'tuberculosis', 'respiratory'] },
  { id: 'endo', label: 'Endocrinology', emoji: '🩸', bg: 'bg-red-50', symptoms: ['diabetes', 'sugar level', 'blood sugar', 'insulin', 'thyroid', 'obesity', 'hormonal', 'endocrinology'] },
  { id: 'oncology', label: 'Oncology / Cancer', emoji: '🎗️', bg: 'bg-pink-50', symptoms: ['cancer', 'tumor', 'chemotherapy', 'radiation', 'biopsy', 'lymphoma', 'oncology', 'breast cancer'] },

  // ─── Specialised Services ────────────────────────────────────────────────────
  { id: 'rheum', label: 'Rheumatology', emoji: '🦴', bg: 'bg-teal-50', symptoms: ['joint swelling', 'rheumatoid', 'lupus', 'arthritis', 'rheumatology', 'autoimmune'] },
  { id: 'haematology', label: 'Haematology', emoji: '🩸', bg: 'bg-red-50', symptoms: ['blood disorder', 'anaemia', 'thalassemia', 'haematology', 'blood cancer', 'platelet'] },
  { id: 'spine', label: 'Spine OPD', emoji: '🦴', bg: 'bg-amber-50', symptoms: ['spine', 'back pain', 'disc', 'spondylosis', 'sciatica'] },
  { id: 'cardiac_bypass', label: 'Cardiac Surgery', emoji: '❤️', bg: 'bg-red-50', symptoms: ['bypass surgery', 'open heart', 'cardiac surgery', 'valve replacement'] },
  { id: 'ctvs', label: 'CTVS', emoji: '🫀', bg: 'bg-rose-50', symptoms: ['ctvs', 'thoracic', 'vascular surgery', 'heart valve'] },
  { id: 'bariatric', label: 'Bariatric Surgery', emoji: '⚖️', bg: 'bg-orange-50', symptoms: ['obesity', 'weight loss surgery', 'bariatric', 'gastric bypass'] },
  { id: 'plastic', label: 'Plastic Surgery', emoji: '🏥', bg: 'bg-indigo-50', symptoms: ['plastic surgery', 'reconstruction', 'burn', 'cosmetic surgery'] },
  { id: 'paed_surg', label: 'Paed. Surgery', emoji: '🏥', bg: 'bg-pink-50', symptoms: ['child surgery', 'pediatric surgery', 'paed surgery'] },
  { id: 'fetal', label: 'Fetal Medicine', emoji: '🤰', bg: 'bg-rose-50', symptoms: ['fetal medicine', 'antenatal', 'pregnancy scan', 'fetal anomaly'] },
  { id: 'family', label: 'Family Medicine', emoji: '👨‍👩‍👧', bg: 'bg-green-50', symptoms: ['family doctor', 'family medicine', 'general health'] },
  { id: 'pain', label: 'Pain Management', emoji: '💊', bg: 'bg-amber-50', symptoms: ['pain management', 'chronic pain', 'interventional pain', 'nerve block'] },
  { id: 'cochlear', label: 'Cochlear Implant', emoji: '👂', bg: 'bg-orange-50', symptoms: ['cochlear implant', 'hearing implant', 'deaf'] },

  // ─── Allied & Diagnostics ─────────────────────────────────────────────────────
  { id: 'dental', label: 'Dental & Oral', emoji: '🦷', bg: 'bg-sky-50', symptoms: ['toothache', 'tooth pain', 'cavity', 'gums', 'braces', 'dental', 'rct', 'root canal', 'implant', 'oral'] },
  { id: 'radiology', label: 'Radiology', emoji: '📡', bg: 'bg-gray-50', symptoms: ['x-ray', 'mri', 'ct scan', 'ultrasound', 'radiology', 'imaging'] },
  { id: 'pathology', label: 'Pathology / Labs', emoji: '🔬', bg: 'bg-teal-50', symptoms: ['blood test', 'lab test', 'report', 'pathology', 'biopsy', 'urine test'] },
  { id: 'anaesthesia', label: 'Anaesthesia', emoji: '💉', bg: 'bg-gray-50', symptoms: ['anaesthesia', 'anaesthetist', 'pre-op', 'pre-operative'] },
  { id: 'critical', label: 'Critical Care / ICU', emoji: '🏨', bg: 'bg-red-50', symptoms: ['icu', 'critical care', 'intensive care', 'ventilator'] },
  { id: 'blood_bank', label: 'Blood Bank', emoji: '🩸', bg: 'bg-red-50', symptoms: ['blood donation', 'blood bank', 'blood transfusion'] },
  { id: 'psychology', label: 'Clinical Psychology', emoji: '🧠', bg: 'bg-purple-50', symptoms: ['psychologist', 'counselling', 'psychology', 'therapy', 'behavior'] },
  { id: 'audiologist', label: 'Audiology & Speech', emoji: '🎙️', bg: 'bg-teal-50', symptoms: ['audiologist', 'speech', 'hearing test', 'hearing loss', 'swallowing'] },
  { id: 'lactation', label: 'Lactation Expert', emoji: '🤱', bg: 'bg-pink-50', symptoms: ['breastfeeding', 'lactation', 'nursing'] },
  { id: 'dietician', label: 'Dietician', emoji: '🥗', bg: 'bg-green-50', symptoms: ['diet', 'nutrition', 'weight', 'dietician', 'meal plan'] },
  { id: 'micro', label: 'Microbiology', emoji: '🦠', bg: 'bg-teal-50', symptoms: ['infection', 'culture test', 'microbiology', 'bacteria', 'virus'] },
  { id: 'biochem', label: 'Bio-Chemistry', emoji: '⚗️', bg: 'bg-yellow-50', symptoms: ['biochemistry', 'enzyme test', 'metabolic panel', 'liver function'] },
];



const Appointments = ({ onNavigate, appointmentForm, setAppointmentForm }) => {
  const theme = useAppTheme();
  const mainContainerRef = useRef(null);
  const [view, setView] = useState('specialties'); // 'specialties' | 'doctors' | 'doctorDetail' | 'slots' | 'form' | 'billing' | 'history'
  const [appointmentHistory, setAppointmentHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Track if date/time were pre-filled from slot selection
  const [slotPreFilled, setSlotPreFilled] = useState(false);
  // Booked appointment data for cancel option on success screen
  const [bookedAppointmentData, setBookedAppointmentData] = useState(null);
  const [pendingAppointmentData, setPendingAppointmentData] = useState(null); // holds data before final booking
  const [showSuccessModal, setShowSuccessModal] = useState(false); // final popup after confirm visit
  const [cancellingAppointment, setCancellingAppointment] = useState(false);
  const [processingId, setProcessingId] = useState(null); // per-appointment action in progress
  const [confirmModal, setConfirmModal] = useState(null); // { type: 'cancel'|'delete', appt: {} }
  const [doctors, setDoctors] = useState([]);
  const [doctorsBySpecialty, setDoctorsBySpecialty] = useState([]);
  const [specialtyLoading, setSpecialtyLoading] = useState(false);
  const [selectedSpecialty, setSelectedSpecialty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [userData, setUserData] = useState(null);
  const [bookingFor, setBookingFor] = useState('self');
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [dateError, setDateError] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [doctorSearchResults, setDoctorSearchResults] = useState([]);
  const [isDoctorSearch, setIsDoctorSearch] = useState(false);
  const [detailDoctor, setDetailDoctor] = useState(null);
  // Slot selection state
  const [slotDoctor, setSlotDoctor] = useState(null);
  const [selectedOpdType, setSelectedOpdType] = useState(''); // 'General OPD' | 'Private OPD'
  const [selectedDate, setSelectedDate] = useState('');
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [slotDateError, setSlotDateError] = useState('');
  const [selectedGeneralDay, setSelectedGeneralDay] = useState(null);
  const [selectedPrivateDay, setSelectedPrivateDay] = useState(null);
  const [selectedGeneralDate, setSelectedGeneralDate] = useState(null);
  const [selectedPrivateDate, setSelectedPrivateDate] = useState(null);
  // Family member picker state
  const [familyMembers, setFamilyMembers] = useState([]);
  const [familyMembersLoading, setFamilyMembersLoading] = useState(false);
  const [selectedFamilyMember, setSelectedFamilyMember] = useState(null);

  const normalizeText = (value) => String(value || '').toLowerCase();
  const normalizeDept = (value) => normalizeText(value)
    .replace(/ae/g, 'e')
    .replace(/[^a-z0-9]+/g, '');
  const parseKeywords = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
    const text = String(value);
    if (text.includes('|')) {
      return text.split('|').map(v => v.trim()).filter(Boolean);
    }
    return [text.trim()].filter(Boolean);
  };
  const getDoctorSearchText = (doctor) => {
    const parts = [
      doctor?.department,
      doctor?.designation,
      doctor?.unit,
      doctor?.unit_notes,
      doctor?.['Company Name'],
      doctor?.consultant_name,
      doctor?.Name
    ];
    return normalizeDept(parts.filter(Boolean).join(' '));
  };

  const matchesDepartment = (doctor, deptKeyword) => {
    if (!deptKeyword) return true;
    const haystack = getDoctorSearchText(doctor);
    if (!haystack) return false;
    const keywords = parseKeywords(deptKeyword);
    if (keywords.length === 0) return true;
    return keywords.some(k => haystack.includes(normalizeDept(k)));
  };
  const matchesDoctorSearch = (doctor, term) => {
    const t = normalizeDept(term);
    if (!t) return true;
    const haystack = getDoctorSearchText(doctor);
    return haystack.includes(t);
  };


  // Get public image URL from Supabase storage
  const getDoctorImageUrl = (doctor) => {
    if (!doctor.doctor_image_url) return null;
    // If it's already a full URL, use it directly
    if (doctor.doctor_image_url.startsWith('http')) return doctor.doctor_image_url;
    // Otherwise build from bucket
    const { data } = supabase.storage.from('doctor-images').getPublicUrl(doctor.doctor_image_url);
    return data?.publicUrl || null;
  };

  // Search doctors by name OR department across all specialties
  const handleSearchChange = async (value) => {
    setSearchTerm(value);
    const term = value.trim().toLowerCase();
    if (!term) {
      setIsDoctorSearch(false);
      setDoctorSearchResults([]);
      return;
    }
    // Search locally by name or department (doctors are already loaded)
    try {
      let source = doctors;
      if (!source || source.length === 0) {
        const trustId = localStorage.getItem('selected_trust_id') || null;
        const trustName = localStorage.getItem('selected_trust_name') || null;
        const response = await getDoctorsWithSchedule({ trustId, trustName });
        source = response?.data || [];
        setDoctors(source);
      }
      const filtered = (source || []).filter(doc => matchesDoctorSearch(doc, term));
      setDoctorSearchResults(filtered);
      setIsDoctorSearch(true);
    } catch (e) {
      setDoctorSearchResults([]);
      setIsDoctorSearch(true);
    }
  };

  // Auto-fill form with a selected family member's details
  const handleSelectFamilyMember = (member) => {
    setSelectedFamilyMember(member);
    // Compute age from dob if age field is missing
    let memberAge = member.age ? String(member.age) : '';
    if (!memberAge && member.dob) {
      const today = new Date();
      const birth = new Date(member.dob);
      let calcAge = today.getFullYear() - birth.getFullYear();
      const mo = today.getMonth() - birth.getMonth();
      if (mo < 0 || (mo === 0 && today.getDate() < birth.getDate())) calcAge--;
      if (calcAge > 0 && calcAge < 120) memberAge = String(calcAge);
    }
    setAppointmentForm(prev => ({
      ...prev,
      patientName: member.name || prev.patientName,
      phone: member.contact_no ? String(member.contact_no).substring(0, 15) : prev.phone,
      gender: member.gender || prev.gender,
      age: memberAge || prev.age,
      relationship: member.relation || prev.relationship,
      relationshipText: '',
    }));
  };

  // Clear a family member selection and reset family-member fields
  const handleClearFamilyMember = () => {
    setSelectedFamilyMember(null);
    setAppointmentForm(prev => ({
      ...prev,
      patientName: '',
      phone: '',
      gender: '',
      age: '',
      relationship: '',
      relationshipText: '',
    }));
  };

  // Select a specialty â€” fetch doctors from Supabase and show listing
  const handleSpecialtySelect = async (specialty) => {
    setSelectedSpecialty(specialty);
    setAppointmentForm(prev => ({ ...prev, reason: specialty.label, category: specialty.id }));
    setSpecialtyLoading(true);
    setView('doctors');
    try {
      const deptKeyword = SPECIALTY_DEPT_MAP[specialty.id] || specialty.label;
      let source = doctors;
      if (!source || source.length === 0) {
        const trustId = localStorage.getItem('selected_trust_id') || null;
        const trustName = localStorage.getItem('selected_trust_name') || null;
        const response = await getDoctorsWithSchedule({ trustId, trustName });
        source = response?.data || [];
        setDoctors(source);
      }
        const filtered = (source || []).filter(doc => matchesDepartment(doc, deptKeyword));
        console.log('ðŸ§ª Specialty filter', {
          specialty: specialty?.label,
          deptKeyword,
          totalDoctors: (source || []).length,
          matched: filtered.length
        });
        setDoctorsBySpecialty(filtered);
    } catch (err) {
      console.error('Error:', err);
      setDoctorsBySpecialty([]);
    } finally {
      setSpecialtyLoading(false);
    }
  };


  // â”€â”€â”€â”€â”€â”€ Slot helpers â”€â”€â”€â”€â”€â”€
  // Parse day-string like "Mon, Wed, Fri" or "Monday-Friday" into abbreviated day names
  const parseDays = (dayStr) => {
    if (!dayStr) return [];
    const dayMap = {
      mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
      monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
      daily: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun'
    };
    const lower = dayStr.toLowerCase();
    if (lower.includes('daily') || lower.includes('all')) return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    // Handle range like Mon-Fri
    const rangeMatch = lower.match(/(\w+)\s*[-â€“]\s*(\w+)/);
    if (rangeMatch) {
      const allDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const start = dayMap[rangeMatch[1]];
      const end = dayMap[rangeMatch[2]];
      if (start && end) {
        const si = allDays.indexOf(start), ei = allDays.indexOf(end);
        return allDays.slice(si, ei + 1);
      }
    }
    return lower.split(/[,/\s]+/).map(d => dayMap[d.trim()]).filter(Boolean);
  };

  const timeToMinutes = (t) => {
    if (!t) return 0;
    const str = String(t).substring(0, 5);
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
  };

  const minutesToTime = (mins) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    const hh = h % 12 === 0 ? 12 : h % 12;
    const ampm = h < 12 ? 'AM' : 'PM';
    return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  // Convert minutes to 24-hour time format (for HTML time input)
  const minutesToTime24 = (mins) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // Convert 12-hour format time (e.g. "09:00 AM") to 24-hour format (e.g. "09:00")
  const convertTo24HourFormat = (time12h) => {
    if (!time12h) return '';

    const [time, modifier] = time12h.split(' ');
    if (!time || !modifier) return time12h; // Return as-is if not in expected format

    let [hours, minutes] = time.split(':');
    hours = parseInt(hours, 10);
    minutes = parseInt(minutes, 10);

    if (isNaN(hours) || isNaN(minutes)) return time12h; // Return as-is if parsing fails

    if (modifier === 'AM' && hours === 12) {
      hours = 0;
    } else if (modifier === 'PM' && hours !== 12) {
      hours += 12;
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  // Convert 24-hour format time (e.g. "14:30:00" or "14:30") to 12-hour AM/PM format (e.g. "02:30 PM")
  const formatTimeToAMPM = (time24h) => {
    if (!time24h) return '';
    try {
      const [h, m] = String(time24h).split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return String(time24h).substring(0, 5); // fallback
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hh = h % 12 === 0 ? 12 : h % 12;
      return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
    } catch {
      return String(time24h).substring(0, 5);
    }
  };

  // Generate time slots from startâ†’end with given duration
  const generateTimeSlots = (start, end, durationMins) => {
    const slots = [];
    const startM = timeToMinutes(start);
    const endM = timeToMinutes(end);
    const dur = durationMins || 15;
    for (let t = startM; t + dur <= endM; t += dur) {
      slots.push(minutesToTime(t));
    }
    return slots;
  };

  // Generate time slots in 24-hour format for form input
  const generateTimeSlots24 = (start, end, durationMins) => {
    const slots = [];
    const startM = timeToMinutes(start);
    const endM = timeToMinutes(end);
    const dur = durationMins || 15;
    for (let t = startM; t + dur <= endM; t += dur) {
      slots.push(minutesToTime24(t));
    }
    return slots;
  };

  // Get day abbreviation for a date string
  const getDayAbbr = (dateStr) => {
    const d = new Date(dateStr);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  };

  // Check if the selected date matches available days
  const isDayValid = (dateStr, dayStr) => {
    const abbr = getDayAbbr(dateStr);
    return parseDays(dayStr).includes(abbr);
  };

  // Get next N upcoming dates for a given day abbreviation (from today)
  const getUpcomingDates = (dayAbbr, count = 5) => {
    const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayAbbr);
    if (dayIndex === -1) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dates = [];
    const cur = new Date(today);
    // start from today
    while (dates.length < count) {
      if (cur.getDay() === dayIndex) {
        const yyyy = cur.getFullYear();
        const mm = String(cur.getMonth() + 1).padStart(2, '0');
        const dd = String(cur.getDate()).padStart(2, '0');
        dates.push({
          value: `${yyyy}-${mm}-${dd}`,
          label: cur.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) // e.g. "26 Feb"
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  };

  // Compute slots for selected OPD type and date from doctor data
  const computeSlots = (doc, opdType, date) => {
    const isGeneral = opdType === 'General OPD';
    // Try stored slots array first (general_opd_slots / private_opd_slots)
    const storedSlots = isGeneral ? (doc.general_opd_slots || []) : (doc.private_opd_slots || []);
    if (Array.isArray(storedSlots) && storedSlots.length > 0) {
      return storedSlots.map(s => (typeof s === 'string' ? s : s.time || s.slot || JSON.stringify(s)));
    }
    // Try schedule JSON (general_opd_schedule / private_opd_schedule)
    // Expected format: [{"day":"Mon","start":"09:00","end":"13:00","duration":15}, ...]
    // or [{"days":"Mon,Wed","start_time":"10:00","end_time":"14:00","slot_duration_minutes":20}]
    const schedule = isGeneral ? (doc.general_opd_schedule || []) : (doc.private_opd_schedule || []);
    if (Array.isArray(schedule) && schedule.length > 0 && date) {
      const dayAbbr = getDayAbbr(date);
      // Find entry matching the selected date's day
      const matched = schedule.find(s => {
        const dayField = s.day || s.days || s.weekday || s.weekdays || '';
        return parseDays(String(dayField)).includes(dayAbbr);
      });
      if (matched) {
        const start = matched.start || matched.start_time || matched.from || matched.startTime;
        const end = matched.end || matched.end_time || matched.to || matched.endTime;
        const dur = matched.duration || matched.slot_duration_minutes || matched.slotDuration ||
          (isGeneral ? doc.general_slot_duration_minutes : doc.private_slot_duration_minutes) ||
          doc.slot_duration_minutes || 15;
        if (start && end) return generateTimeSlots(start, end, Number(dur));
      }
      // If schedule has no day field (single schedule for all days), just use first entry
      const first = schedule[0];
      const start = first.start || first.start_time || first.from || first.startTime;
      const end = first.end || first.end_time || first.to || first.endTime;
      const dur = first.duration || first.slot_duration_minutes || doc.slot_duration_minutes || 15;
      if (start && end) return generateTimeSlots(start, end, Number(dur));
    }
    // Fall back to top-level start/end times
    const start = isGeneral ? doc.general_opd_start : doc.private_opd_start;
    const end = isGeneral ? doc.general_opd_end : doc.private_opd_end;
    const dur = (isGeneral ? doc.general_slot_duration_minutes : doc.private_slot_duration_minutes) ||
      doc.slot_duration_minutes || 15;
    if (start && end) return generateTimeSlots(start, end, Number(dur));
    return [];
  };

  // Kick off slot view when a doctor is picked
  const handleBookDoctor = (doc) => {
    setSlotDoctor(doc);
    setSelectedDoctor(doc);
    setSlotPreFilled(false); // reset pre-fill flag
    
    // Ensure doctorName is captured with proper fallbacks
    const docName = doc?.consultant_name || doc?.name || doc?.doctor_name || 'Unknown';
    
    setAppointmentForm(prev => ({
      ...prev,
      doctor: String(doc.id),
      doctorName: docName,
      department: doc.department,
      opdType: '',
      date: '',
      time: ''
    }));
    // Auto-select OPD type if only one exists
    const hasGeneral = !!(doc.general_opd_days || doc.general_opd_start);
    const hasPrivate = !!(doc.private_opd_days || doc.private_opd_start);
    const autoType = hasGeneral && !hasPrivate ? 'General OPD' : (!hasGeneral && hasPrivate ? 'Private OPD' : '');
    setSelectedOpdType(autoType);
    setSelectedDate('');
    setAvailableSlots([]);
    setSelectedSlot(null);
    setSlotDateError('');
    setSelectedGeneralDay(null);
    setSelectedPrivateDay(null);
    setSelectedGeneralDate(null);
    setSelectedPrivateDate(null);
    setView('slots');
  };

  // Fetch appointment history for current user
  const fetchAppointmentHistory = async () => {
    setHistoryLoading(true);
    try {
      const user = localStorage.getItem('user');
      const userId = user
        ? JSON.parse(user).Mobile || JSON.parse(user).mobile || JSON.parse(user).id
        : null;
      if (!userId) return;
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .or(`patient_phone.eq.${String(userId)},user_id.eq.${String(userId)}`)
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error) setAppointmentHistory(data || []);
    } catch (err) {
      console.error('Error fetching history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Register sidebar state with Android back handler
  useEffect(() => {
    registerSidebarState(isMenuOpen, () => setIsMenuOpen(false));
  }, [isMenuOpen]);

  // Register Android hardware back handler for internal appointment views
  // Use refs to hold stable references â€” functions from useAndroidBack() change
  // reference every render which would cause an infinite loop if put in deps array.
  const { registerBackHandler, unregisterHandler } = useAndroidBack();
  const registerBackHandlerRef = useRef(registerBackHandler);
  const unregisterHandlerRef = useRef(unregisterHandler);
  useEffect(() => {
    registerBackHandlerRef.current = registerBackHandler;
    unregisterHandlerRef.current = unregisterHandler;
  });

  useEffect(() => {
    // Only intercept back button when in a sub-view (not the top-level specialties)
    // When at specialties view, let the global provider navigate to parent route ('/')
    if (view === 'specialties') {
      // Unregister so global back handler navigates to home
      unregisterHandlerRef.current();
      return;
    }

    // For all sub-views, register a handler that moves one step back
    const unregister = registerBackHandlerRef.current(() => {
      if (view === 'form') {
        setSlotPreFilled(false);
        setView('slots');
        return;
      }
      if (view === 'slots' || view === 'doctorDetail') {
        setView('doctors');
        return;
      }
      if (view === 'doctors' || view === 'history') {
        setView('specialties');
        return;
      }
    });

    return () => {
      try { if (typeof unregister === 'function') unregister(); } catch (e) { }
    };
  }, [view]); // Only re-run when view changes, not on every render

  // Close sidebar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMenuOpen) {
        // Check if click is inside sidebar or overlay
        const isSidebarClick = event.target.closest('[data-sidebar="true"]') ||
          event.target.closest('[data-sidebar-overlay="true"]');

        // Only close if clicking outside both
        if (!isSidebarClick) {
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

  // Load user data from localStorage + Supabase profile on mount
  useEffect(() => {
    const loadUserData = async () => {
      const user = localStorage.getItem('user');
      if (user) {
        try {
          const parsedUser = JSON.parse(user);
          setUserData(parsedUser);

          // Base data from localStorage
          let name = parsedUser['Name'] || parsedUser.name || '';
          let phone = (parsedUser['Mobile'] || parsedUser.mobile || '').substring(0, 15);
          let email = parsedUser['Email'] || parsedUser.email || '';
          let membershipNumber = parsedUser['Membership number'] || parsedUser.membership_number || '';
          let address = parsedUser['Address Home'] || parsedUser.address || '';
          let age = '';

          // Try to enrich from Supabase user_profiles table
          try {
            const userId = parsedUser['Mobile'] || parsedUser.mobile || parsedUser.id;
            const userIdentifier = parsedUser['Membership number'] || parsedUser.membership_number || userId;
            if (userIdentifier) {
              const { data: profile } = await supabase
                .from('user_profiles')
                .select('name, email, mobile, address_home, member_id, dob')
                .eq('user_identifier', String(userIdentifier))
                .maybeSingle();
              if (profile) {
                name = profile.name || name;
                email = profile.email || email;
                phone = (profile.mobile || phone).substring(0, 15);
                address = profile.address_home || address;
                membershipNumber = profile.member_id || membershipNumber;
                // Calculate age from dob
                if (profile.dob) {
                  const today = new Date();
                  const birth = new Date(profile.dob);
                  let calcAge = today.getFullYear() - birth.getFullYear();
                  const m = today.getMonth() - birth.getMonth();
                  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) calcAge--;
                  if (calcAge > 0 && calcAge < 120) age = String(calcAge);
                }
              }
            }
          } catch (_) { /* profile fetch is optional */ }


          // Auto-populate form with user data
          setAppointmentForm(prev => ({
            ...prev,
            bookingFor: 'self',
            patientName: name,
            phone,
            email,
            membershipNumber,
            address,
            age: age || prev.age || '',
            time: prev.time || ''
          }));
        } catch (error) {
          console.error('Error loading user data:', error);
        }
      }
    };
    loadUserData();
  }, []);



  // Scroll to top whenever view changes
  useEffect(() => {
    window.scrollTo(0, 0);
    if (mainContainerRef.current) {
      mainContainerRef.current.scrollTop = 0;
    }
  }, [view]);

  // Fetch doctors from backend
  useEffect(() => {
    const fetchDoctors = async () => {
      try {
        setLoading(true);
        const trustId = localStorage.getItem('selected_trust_id') || null;
        const trustName = localStorage.getItem('selected_trust_name') || null;
        const response = await getDoctorsWithSchedule({ trustId, trustName });
        console.log('âœ… Fetched doctors:', response);
        const list = response?.data || [];
        const deptSet = new Set(list.map(d => d?.department).filter(Boolean));
        console.log('ðŸ§ª Doctor departments (sample):', [...deptSet].slice(0, 20));
        const emptyDeptCount = list.filter(d => !d?.department).length;
        console.log('ðŸ§ª Doctors missing department:', emptyDeptCount, '/', list.length);
        setDoctors(response.data || []);
        setError('');
      } catch (error) {
        console.error('âŒ Error fetching doctors:', error);
        setError('Failed to load doctors. Please try again.');
        setDoctors([]);
      } finally {
        setLoading(false);
      }
    };

    fetchDoctors();
  }, []);

  const handleDoctorChange = (e) => {
    const doctorId = e.target.value;
    const doctor = doctors.find(d => String(d.original_id) === String(doctorId) || String(d.id) === String(doctorId) || String(d['S. No.']) === String(doctorId));
    setSelectedDoctor(doctor);
    
    // Ensure doctorName is captured with proper fallbacks
    const docName = doctor?.consultant_name || doctor?.name || doctor?.doctor_name || '';
    
    setAppointmentForm({
      ...appointmentForm,
      doctor: doctorId,
      doctorName: docName,
      department: doctor?.department || '',
      opdType: ''
    });
    setDateError('');
  };

  const handleDateChange = (e) => {
    const selectedDateValue = e.target.value;
    if (!selectedDateValue) {
      setAppointmentForm({ ...appointmentForm, date: '' });
      setDateError('');
      return;
    }

    const selectedDate = new Date(selectedDateValue);
    const dayName = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
    const dayShort = dayName.substring(0, 3).toLowerCase();

    let availableDays = '';
    if (appointmentForm.opdType === 'General OPD') {
      availableDays = (selectedDoctor?.general_opd_days || selectedDoctor?.general_opd)?.toLowerCase() || '';
    } else if (appointmentForm.opdType === 'Private OPD') {
      availableDays = (selectedDoctor?.private_opd_days || selectedDoctor?.private_opd)?.toLowerCase() || '';
    }

    if (selectedDoctor && appointmentForm.opdType && !availableDays.includes(dayShort) && !availableDays.includes('daily')) {
      setDateError('This date is not available for the selected doctor and OPD type.');
      setAppointmentForm({ ...appointmentForm, date: '', time: '' });
    } else {
      setDateError('');
      setAppointmentForm({ ...appointmentForm, date: selectedDateValue });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    // Find selected doctor
    const selectedDoc = selectedDoctor || doctors.find(d =>
      String(d.original_id) === String(appointmentForm.doctor) ||
      String(d.id) === String(appointmentForm.doctor) ||
      String(d['S. No.']) === String(appointmentForm.doctor)
    );

    // Validate phone number length
    if (appointmentForm.phone && appointmentForm.phone.length > 15) {
      setError('Phone number must not exceed 15 characters');
      return;
    }

    // Age & gender mandatory
    const ageNum = Number(appointmentForm.age);
    if (!appointmentForm.patientName || !appointmentForm.phone || !appointmentForm.doctor ||
      !appointmentForm.date || !appointmentForm.time || !appointmentForm.reason ||
      !appointmentForm.age || isNaN(ageNum) || ageNum < 1 || ageNum > 120 || !appointmentForm.gender) {
      setError('Please fill in all required fields (including valid age and gender)');
      return;
    }

    // Prepare appointment data (not saved yet â€” shown on billing page first)
    const opdFee = appointmentForm.opdType === 'Private OPD'
      ? (selectedDoc?.private_fee ?? (selectedDoc?.consultation_fee || null))
      : (selectedDoc?.general_fee ?? (selectedDoc?.consultation_fee || null));

    const appointmentData = {
      patient_name: appointmentForm.patientName,
      patient_phone: appointmentForm.phone,
      // Appointment booking emails are disabled for this flow.
      patient_email: '',
      patient_age: appointmentForm.age || null,
      patient_gender: appointmentForm.gender || '',
      membership_number: appointmentForm.membershipNumber || '',
      doctor_id: appointmentForm.doctor,
      doctor_name: appointmentForm.doctorName,
      doctor_image: selectedDoc?.doctor_image_url || null,
      doctor_qualification: selectedDoc?.qualification || '',
      doctor_designation: selectedDoc?.designation || '',
      department: appointmentForm.department,
      hospital_name: selectedDoc?.hospital_name || '',
      hospital_address: selectedDoc?.hospital_address || '',
      consultation_fee: opdFee,
      opd_type: appointmentForm.opdType || 'General OPD',
      appointment_date: appointmentForm.date,
      appointment_time: appointmentForm.time || null,
      appointment_type: appointmentForm.appointmentType || 'General Consultation',
      reason: appointmentForm.reason,
      medical_history: appointmentForm.medicalHistory || '',
      address: appointmentForm.address || '',
      user_type: userData?.type || '',
      user_id: userData?.Mobile || userData?.mobile || '',
      booking_for: appointmentForm.bookingFor || 'self',
      patient_relationship: appointmentForm.bookingFor === 'family'
        ? (appointmentForm.relationship === 'Other'
          ? (appointmentForm.relationshipText || 'Other')
          : (appointmentForm.relationship || 'Other'))
        : 'Self',
      is_first_visit: appointmentForm.isFirstVisit === 'yes' ? true : appointmentForm.isFirstVisit === 'no' ? false : null
    };

    // Move to billing/confirmation page
    setPendingAppointmentData(appointmentData);
    setView('billing');
    window.scrollTo(0, 0);
  };

  // Actually book the appointment after user confirms on billing page
  const handleConfirmVisit = async () => {
    if (!pendingAppointmentData) return;
    setSubmitting(true);
    setError('');
    try {
      console.log('ðŸ“¤ Confirming appointment:', pendingAppointmentData);

      const response = await bookAppointment(pendingAppointmentData);
      console.log('âœ… Appointment booked successfully:', response);

      const appointmentId = response?.data?.id || response?.id || '';
      const backendNotificationSent = response?.notificationSent === true;

      // Fallback: if backend notification insert fails, create one directly.
      if (!backendNotificationSent) {
        const patientPhone = String(pendingAppointmentData?.patient_phone || '').trim();
        const digits = patientPhone.replace(/\D/g, '');
        const recipientId = digits.length >= 10 ? digits.slice(-10) : (digits || patientPhone);

        const patientName = pendingAppointmentData?.patient_name || 'Patient';
        const doctorName = pendingAppointmentData?.doctor_name || pendingAppointmentData?.doctorName || 'Doctor Not Assigned';
        const department = pendingAppointmentData?.department || 'General';
        const appointmentDate = pendingAppointmentData?.appointment_date || 'Not specified';
        const appointmentTime = pendingAppointmentData?.appointment_time || 'Not specified';
        const bookingMsg =
          `Hello ${patientName}, your appointment has been booked successfully. ` +
          `Doctor: ${doctorName} | Department: ${department} | ` +
          `Date: ${appointmentDate} at ${appointmentTime} | ` +
          `Appointment ID: #${appointmentId || 'N/A'} | Status: Booked`;
        const notificationPayload = {
          user_id: recipientId,
          title: 'âœ… Appointment Booked',
          message: bookingMsg,
          type: 'appointment_insert',
          is_read: false,
          created_at: new Date().toISOString(),
        };

        if (recipientId) {
          const { error: notifError } = await supabase.from('notifications').insert(notificationPayload);
          if (notifError) {
            console.error('âš ï¸ Fallback booking notification failed:', notifError);
          }
        }
      }

      // Store booked data and show success modal
      setBookedAppointmentData({ ...pendingAppointmentData, id: appointmentId });
      setShowSuccessModal(true);
      fetchAppointmentHistory();

    } catch (error) {
      console.error('âŒ Error booking appointment:', error);
      setError(error.message || 'Failed to book appointment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };



  // Cancel an appointment and save cancellation notification to Supabase
  const handleCancelAppointment = async (apptId, patientPhone, _doctorName, _appointmentDate, fromSuccess = false) => {
    setProcessingId(apptId);
    setCancellingAppointment(true);
    try {
      // Update appointment status to cancelled
      if (apptId) {
        await supabase
          .from('appointments')
          .update({ status: 'cancelled' })
          .eq('id', apptId);
      }

      // Insert cancellation notification
      const patientName =
        pendingAppointmentData?.patient_name ||
        bookedAppointmentData?.patient_name ||
        appointmentHistory.find(a => a.id === apptId)?.patient_name ||
        'Patient';
      const cancelMsg = `âŒ Appointment Cancelled\nðŸ‘¤ ${patientName}\nðŸ†” #${apptId || ''}`;
      await supabase.from('notifications').insert({
        user_id: patientPhone,
        title: 'âŒ Appointment Cancelled',
        message: cancelMsg,
        type: 'appointment_update',
        is_read: false,
        created_at: new Date().toISOString(),
      });

      setConfirmModal(null);
      if (fromSuccess) {
        setShowSuccessModal(false);
        setBookedAppointmentData(null);
        setPendingAppointmentData(null);
        onNavigate('home');
      } else {
        // Mark as cancelled in history list (keep the record visible)
        setAppointmentHistory(prev =>
          prev.map(a => a.id === apptId ? { ...a, status: 'cancelled' } : a)
        );
      }
    } catch (err) {
      console.error('Cancel error:', err);
      setConfirmModal(null);
    } finally {
      setCancellingAppointment(false);
      setProcessingId(null);
    }
  };

  // Delete an appointment record from history (permanent)
  const handleDeleteAppointment = async (apptId) => {
    setProcessingId(apptId);
    try {
      const { error } = await supabase.from('appointments').delete().eq('id', apptId);
      if (!error) {
        setAppointmentHistory(prev => prev.filter(a => a.id !== apptId));
      }
      setConfirmModal(null);
    } catch (err) {
      console.error('Delete error:', err);
      setConfirmModal(null);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div
      ref={mainContainerRef}
      className={`bg-white min-h-screen pb-10 relative${isMenuOpen ? ' overflow-hidden max-h-screen' : ''}`}
    >
      {/* Navbar */}
      <div className="theme-navbar border-b px-4 sm:px-6 py-5 flex items-center justify-between sticky top-0 z-50 transition-all duration-300 pointer-events-auto" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}>
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="p-2 rounded-xl hover:bg-gray-100 transition-colors pointer-events-auto"
        >
          {isMenuOpen ? <X className="h-6 w-6" style={{ color: 'var(--navbar-text)' }} /> : <Menu className="h-6 w-6" style={{ color: 'var(--navbar-text)' }} />}
        </button>
        <h1 className="text-lg font-bold transition-colors" style={{ color: 'var(--navbar-text)' }}>
          {view === 'specialties' ? 'OPD Schedule' : view === 'doctors' ? (selectedSpecialty?.label || 'Doctors') : view === 'doctorDetail' ? 'Doctor Profile' : view === 'slots' ? 'Select Slot' : view === 'history' ? 'OPD Schedule History' : view === 'billing' ? 'OPD Schedule Summary' : 'OPD Schedule'}
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (view === 'billing') { setView('form'); setPendingAppointmentData(null); }
              else if (view === 'form') { setSlotPreFilled(false); setView('slots'); }
              else if (view === 'slots') setView('doctors');
              else if (view === 'doctorDetail') setView('doctors');
              else if (view === 'doctors') setView('specialties');
              else if (view === 'history') setView('specialties');
              else onNavigate('home');
            }}
            className="p-2 rounded-xl transition-colors flex items-center justify-center hover:bg-gray-100" style={{ color: 'var(--navbar-text)' }}
            title="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => onNavigate('home')}
            className="p-2 rounded-xl transition-colors flex items-center justify-center hover:bg-gray-100" style={{ color: 'var(--navbar-text)' }}
          >
            <HomeIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      <Sidebar
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onNavigate={onNavigate}
        currentPage="appointments"
      />

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ SPECIALTIES SELECTION PAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {view === 'specialties' && (
        <div className="bg-white min-h-screen pb-10">

          {/* Top indigo header */}
          <div className="px-5 pt-4 pb-8" style={{ background: `linear-gradient(135deg, ${theme.secondary}, ${theme.primary})` }}>
            <p className="text-indigo-100 text-sm mt-1 mb-4">Find the right specialist for your concern</p>
            {/* History card button in banner */}
            <button
              onClick={() => { setView('history'); fetchAppointmentHistory(); }}
              className="w-full flex items-center gap-3 bg-white/15 hover:bg-white/25 active:bg-white/30 backdrop-blur-sm rounded-2xl px-4 py-3 transition-all"
            >
              <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                <History className="w-5 h-5 text-white" />
              </div>
              <div className="text-left flex-1">
                <p className="text-white font-semibold text-sm">My OPD Schedule</p>
                <p className="text-[11px] opacity-70 text-white">View your booking history</p>
              </div>
              <ChevronRight className="w-4 h-4 text-white opacity-70" />
            </button>
          </div>

          {/* White card pulled up over blue header */}
          <div className="bg-white rounded-t-3xl -mt-3 pt-5 px-4">
            <h3 className="text-lg font-bold text-gray-900 mb-1">All Specialities</h3>
            <p className="text-xs text-gray-400 mb-4">Search by specialty, symptom, or doctor name</p>

            {/* Search input */}
            <div className="mb-5 relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Stethoscope className="w-4 h-4 text-indigo-400" />
              </div>
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="e.g. fever, heart, Dr. Sharma..."
                className="w-full pl-10 pr-4 py-3 rounded-2xl border-2 border-indigo-100 bg-indigo-50/40 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-300 focus:bg-white text-sm transition-all"
              />
              {searchTerm && (
                <button
                  onClick={() => handleSearchChange('')}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Doctor name search results */}
            {isDoctorSearch && doctorSearchResults.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-semibold text-indigo-600 mb-2 uppercase tracking-wider">Doctors Found</p>
                <div className="space-y-2">
                  {doctorSearchResults.map((doc) => {
                    const imgUrl = getDoctorImageUrl(doc);
                    return (
                      <button
                        key={doc.id}
                        onClick={() => handleBookDoctor(doc)}
                        className="w-full flex items-center gap-3 p-3 bg-indigo-50 rounded-2xl hover:bg-indigo-100 active:scale-95 transition-all text-left"
                      >
                        <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center flex-shrink-0 border border-indigo-100 overflow-hidden">
                          {imgUrl ? (
                            <img src={imgUrl} alt={doc.consultant_name} className="w-full h-full object-cover" onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }} />
                          ) : (
                            <span className="text-xl">ðŸ‘¨â€âš•ï¸</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-gray-900 text-sm truncate">{doc.consultant_name}</p>
                          <p className="text-indigo-600 text-xs truncate">{doc.department}</p>
                          {doc.designation && <p className="text-gray-400 text-[10px] truncate">{doc.designation}</p>}
                        </div>
                        <div className="flex-shrink-0">
                          <span className="text-xs bg-indigo-600 text-white px-2 py-1 rounded-lg font-semibold">Book</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* No results message */}
            {searchTerm.trim() && isDoctorSearch && doctorSearchResults.length === 0 && (
              <div className="mb-4 flex flex-col items-center py-6 gap-2">
                <span className="text-3xl">ðŸ”</span>
                <p className="text-gray-600 font-semibold text-sm">No results found</p>
                <p className="text-gray-400 text-xs text-center">Try searching by specialty or symptom name</p>
              </div>
            )}

            {/* Specialties grid â€” hidden when doctor search results are shown */}
            {!isDoctorSearch && (
              <>
                {searchTerm.trim() && (
                  <p className="text-xs font-semibold text-indigo-600 mb-2 uppercase tracking-wider">Matching Specialities</p>
                )}
                <div className="grid grid-cols-4 gap-x-2 gap-y-5">
                  {SPECIALTIES.filter(sp => {
                    const term = searchTerm.trim().toLowerCase();
                    if (!term) return true;
                    return sp.label.toLowerCase().includes(term) ||
                      (sp.symptoms && sp.symptoms.some(s => s.toLowerCase().includes(term)));
                  }).map((sp) => (
                    <button
                      key={sp.id}
                      onClick={() => handleSpecialtySelect(sp)}
                      className="flex flex-col items-center gap-2 active:scale-95 transition-transform"
                    >
                      <div className={`w-16 h-16 rounded-full ${sp.bg} flex items-center justify-center shadow-sm`}>
                        <span style={{ fontSize: '2rem', lineHeight: 1 }}>{sp.emoji}</span>
                      </div>
                      <p className="text-[11px] text-gray-700 font-medium text-center leading-tight">{sp.label}</p>
                    </button>
                  ))}
                </div>
                {searchTerm.trim() && SPECIALTIES.filter(sp => {
                  const term = searchTerm.trim().toLowerCase();
                  return sp.label.toLowerCase().includes(term) ||
                    (sp.symptoms && sp.symptoms.some(s => s.toLowerCase().includes(term)));
                }).length === 0 && (
                    <div className="flex flex-col items-center py-6 gap-2">
                      <span className="text-3xl">ðŸ”</span>
                      <p className="text-gray-600 font-semibold text-sm">No matching speciality</p>
                      <p className="text-gray-400 text-xs text-center">Try searching by doctor name instead</p>
                    </div>
                  )}
              </>
            )}
          </div>
        </div>
      )}

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ DOCTORS BY SPECIALTY PAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {view === 'doctors' && (
        <div className="bg-gray-50 min-h-screen pb-16">
          {/* Cards area */}
          <div className="px-4 space-y-4 pt-4">
            {specialtyLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-500 text-sm">Finding doctors...</p>
              </div>
            ) : doctorsBySpecialty.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center text-3xl">ðŸ”</div>
                <p className="text-gray-700 font-semibold">No doctors found</p>
                <p className="text-gray-500 text-sm text-center px-8">No specialists available for {selectedSpecialty?.label} right now.</p>
                <button
                  onClick={() => setView('specialties')}
                  className="mt-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold"
                >
                  Browse Other Specialties
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-500 pt-2 font-medium">{doctorsBySpecialty.length} doctor{doctorsBySpecialty.length !== 1 ? 's' : ''} available</p>
                {doctorsBySpecialty.map((doc) => {
                  const imgUrl = getDoctorImageUrl(doc);
                  return (
                    <div key={doc.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                      {/* Top info area */}
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          {/* Doctor Image */}
                          <div className="flex-shrink-0">
                            {imgUrl ? (
                              <img
                                src={imgUrl}
                                alt={doc.consultant_name}
                                className="w-20 h-20 rounded-2xl object-cover border-2 border-indigo-100"
                                onError={(e) => {
                                  e.target.onerror = null;
                                  e.target.style.display = 'none';
                                  e.target.nextSibling.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <div
                              className="w-20 h-20 rounded-2xl bg-indigo-50 border-2 border-indigo-100 flex items-center justify-center"
                              style={{ display: imgUrl ? 'none' : 'flex' }}
                            >
                              <span className="text-3xl">ðŸ‘¨â€âš•ï¸</span>
                            </div>
                          </div>

                          {/* Doctor Info */}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-gray-900 text-base leading-tight">{doc.consultant_name}</h3>
                            {doc.designation && (
                              <p className="text-indigo-600 text-xs font-semibold mt-0.5">{doc.designation}</p>
                            )}
                            {doc.qualification && (
                              <p className="text-gray-500 text-xs mt-0.5">{doc.qualification}</p>
                            )}
                            {doc.department && (
                              <span className="inline-block mt-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-semibold">
                                {doc.department}{doc.unit ? ` Â· ${doc.unit}` : ''}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Stats Row */}
                        <div className="mt-3 flex flex-wrap gap-3">
                          {doc.experience_years > 0 && (
                            <div className="flex items-center gap-1 text-xs text-gray-600">
                              <Award className="w-3.5 h-3.5 text-amber-500" />
                              <span className="font-semibold">{doc.experience_years} yrs</span>
                              <span className="text-gray-400">experience</span>
                            </div>
                          )}
                          {/* Consultation fee is shown inside OPD sections (General/Private), not here */}
                          {doc.hospital_name && (
                            <div className="flex items-center gap-1 text-xs text-gray-600">
                              <MapPin className="w-3.5 h-3.5 text-red-400" />
                              <span className="truncate max-w-[140px]">{doc.hospital_name}</span>
                            </div>
                          )}
                        </div>

                        {/* OPD Schedule */}
                        {(doc.general_opd_days || doc.private_opd_days) && (
                          <div className="mt-3 space-y-1">
                            {doc.general_opd_days && (
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                                <p className="text-xs text-gray-600">
                                  <span className="font-semibold text-gray-700">General OPD: </span>
                                  {doc.general_opd_days}
                                  {doc.general_opd_start && (
                                    <span className="text-gray-400"> Â· {String(doc.general_opd_start).substring(0, 5)}</span>
                                  )}
                                </p>
                              </div>
                            )}
                            {doc.private_opd_days && (
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
                                <p className="text-xs text-gray-600">
                                  <span className="font-semibold text-gray-700">Private OPD: </span>
                                  {doc.private_opd_days}
                                  {doc.private_opd_start && (
                                    <span className="text-gray-400"> Â· {String(doc.private_opd_start).substring(0, 5)}</span>
                                  )}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Buttons */}
                      <div className="px-4 pb-4 flex gap-2">
                        <button
                          onClick={() => { setDetailDoctor(doc); setView('doctorDetail'); }}
                          className="flex-1 py-3 bg-white border-2 border-indigo-600 text-indigo-600 rounded-2xl font-semibold text-sm active:scale-[0.98] transition-all"
                        >
                          View Details
                        </button>
                        <button
                          onClick={() => handleBookDoctor(doc)}
                          className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-all hover:bg-indigo-700"
                        >
                          Book Appointment
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ DOCTOR DETAIL PAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {view === 'doctorDetail' && detailDoctor && (() => {
        const doc = detailDoctor;
        const imgUrl = getDoctorImageUrl(doc);
        return (
          <div className="bg-gray-50 min-h-screen pb-6">
            {/* Hero Card */}
            <div className="bg-white mx-4 mt-4 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="flex gap-4 p-4">
                {/* Doctor Photo */}
                <div className="flex-shrink-0">
                  {imgUrl ? (
                    <img
                      src={imgUrl}
                      alt={doc.consultant_name}
                      className="w-28 h-32 rounded-xl object-cover border-2 border-indigo-100"
                      onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                    />
                  ) : null}
                  <div
                    className="w-28 h-32 rounded-xl bg-indigo-50 border-2 border-indigo-100 flex items-center justify-center text-5xl"
                    style={{ display: imgUrl ? 'none' : 'flex' }}
                  >
                    ðŸ‘¨â€âš•ï¸
                  </div>
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-gray-900 text-lg leading-tight">{doc.consultant_name}</h2>
                  {doc.department && (
                    <p className="text-indigo-600 text-sm font-semibold mt-0.5">{doc.department}</p>
                  )}
                  {doc.qualification && (
                    <p className="text-gray-500 text-xs mt-1">{doc.qualification}</p>
                  )}
                  {doc.designation && (
                    <span className="inline-block mt-2 px-2 py-0.5 bg-indigo-600 text-white rounded-full text-[10px] font-semibold">
                      {doc.designation}
                    </span>
                  )}
                  {doc.experience_years > 0 && (
                    <p className="text-gray-700 text-xs font-bold mt-2">
                      {doc.experience_years} Years Experience
                    </p>
                  )}
                </div>
              </div>

              {/* Stats row */}
              <div className="flex divide-x divide-gray-100 border-t border-gray-100">
                {doc.experience_years > 0 && (
                  <div className="flex-1 py-3 flex flex-col items-center gap-0.5">
                    <span className="text-indigo-600 font-bold text-base">{doc.experience_years}+</span>
                    <span className="text-gray-400 text-[10px] text-center">Years Exp.</span>
                  </div>
                )}
                {/* Consultation fee is shown inside OPD sections (General/Private), not here */}
                {doc.hospital_name && (
                  <div className="flex-1 py-3 flex flex-col items-center gap-0.5 px-1">
                    <span className="text-red-400 font-bold text-base">ðŸ¥</span>
                    <span className="text-gray-400 text-[10px] text-center leading-tight truncate w-full px-1">{doc.hospital_name?.split(' ').slice(0, 2).join(' ')}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Contact */}
            {doc.mobile && (
              <div className="mx-4 mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Contact</p>
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                  <a href={`tel:${doc.mobile}`} className="text-sm font-semibold text-indigo-600">{doc.mobile}</a>
                </div>
              </div>
            )}

            {/* Hospital / Location card */}
            {doc.hospital_name && (
              <div className="mx-4 mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Hospital</p>
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{doc.hospital_name}</p>
                    {doc.hospital_address && <p className="text-gray-400 text-xs mt-0.5">{doc.hospital_address}</p>}
                  </div>
                </div>
              </div>
            )}

            {/* OPD Schedule card */}
            {(doc.general_opd_days || doc.private_opd_days || doc.general_opd || doc.private_opd ||
              (Array.isArray(doc.general_opd_schedule) && doc.general_opd_schedule.length > 0) ||
              (Array.isArray(doc.private_opd_schedule) && doc.private_opd_schedule.length > 0)) && (() => {
                // Extract day chips from JSON schedule or fallback to text field
                const extractDayChips = (scheduleJson, dayText) => {
                  const days = new Set();
                  if (Array.isArray(scheduleJson) && scheduleJson.length > 0) {
                    scheduleJson.forEach(s => {
                      const d = String(s.day || s.days || s.weekday || s.weekdays || '');
                      if (d) parseDays(d).forEach(x => days.add(x));
                    });
                  }
                  if (days.size === 0 && dayText) {
                    parseDays(dayText).forEach(x => days.add(x));
                  }
                  return [...days];
                };

                const generalDayChips = extractDayChips(doc.general_opd_schedule, doc.general_opd_days || doc.general_opd);
                const privateDayChips = extractDayChips(doc.private_opd_schedule, doc.private_opd_days || doc.private_opd);
                const hasGeneral = generalDayChips.length > 0 || doc.general_opd_days || doc.general_opd;
                const hasPrivate = privateDayChips.length > 0 || doc.private_opd_days || doc.private_opd;

                return (
                  <div className="mx-4 mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Calendar className="w-4 h-4 text-indigo-600" />
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Available Days & Timings</p>
                    </div>
                    <div className="space-y-4">

                      {/* General OPD */}
                      {hasGeneral && (
                        <div className="bg-green-50 rounded-xl p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            <span className="text-xs font-bold text-green-700">General OPD</span>
                          </div>

                          {/* Day chips */}
                          {generalDayChips.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 mb-2 ml-4">
                              {generalDayChips.map(day => (
                                <span key={day} className="px-2.5 py-1 bg-green-100 text-green-800 rounded-full text-[11px] font-bold border border-green-200">
                                  {day}
                                </span>
                              ))}
                            </div>
                          ) : (doc.general_opd_days || doc.general_opd) ? (
                            <p className="text-xs text-gray-600 ml-4 mb-1">{doc.general_opd_days || doc.general_opd}</p>
                          ) : null}

                          {/* Timings */}
                          {(doc.general_opd_start || doc.general_opd_end) && (
                            <p className="text-xs text-gray-500 ml-4 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {doc.general_opd_start && String(doc.general_opd_start).substring(0, 5)}
                              {doc.general_opd_start && doc.general_opd_end && ' â€“ '}
                              {doc.general_opd_end && String(doc.general_opd_end).substring(0, 5)}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Private OPD */}
                      {hasPrivate && (
                        <div className="bg-indigo-50 rounded-xl p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="w-2 h-2 rounded-full bg-indigo-500" />
                            <span className="text-xs font-bold text-indigo-700">Private OPD</span>
                          </div>

                          {/* Day chips */}
                          {privateDayChips.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 mb-2 ml-4">
                              {privateDayChips.map(day => (
                                <span key={day} className="px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-full text-[11px] font-bold border border-indigo-200">
                                  {day}
                                </span>
                              ))}
                            </div>
                          ) : (doc.private_opd_days || doc.private_opd) ? (
                            <p className="text-xs text-gray-600 ml-4 mb-1">{doc.private_opd_days || doc.private_opd}</p>
                          ) : null}

                          {/* Timings */}
                          {(doc.private_opd_start || doc.private_opd_end) && (
                            <p className="text-xs text-gray-500 ml-4 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {doc.private_opd_start && String(doc.private_opd_start).substring(0, 5)}
                              {doc.private_opd_start && doc.private_opd_end && ' â€“ '}
                              {doc.private_opd_end && String(doc.private_opd_end).substring(0, 5)}
                            </p>
                          )}
                        </div>
                      )}

                    </div>
                  </div>
                );
              })()}

            {/* About / Additional info */}
            {(doc.notes || doc.about) && (
              <div className="mx-4 mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">About</p>
                <p className="text-sm text-gray-600 leading-relaxed">{doc.notes || doc.about}</p>
              </div>
            )}

            {/* Buttons */}
            <div className="mx-4 mt-6 mb-4 flex gap-3">
              <button
                onClick={() => setView('doctors')}
                className="flex-1 py-3 bg-white border-2 border-indigo-600 text-indigo-600 rounded-2xl font-semibold text-sm active:scale-[0.98] transition-all"
              >
                â† Back
              </button>
              <button
                onClick={() => { handleBookDoctor(doc); }}
                className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-all hover:bg-indigo-700"
              >
                Book Appointment
              </button>
            </div>
          </div>
        );
      })()}

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ SLOT SELECTION PAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {view === 'slots' && slotDoctor && (() => {
        const doc = slotDoctor;
        const imgUrl = getDoctorImageUrl(doc);
        const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format

        const handleSlotPick = (opdType, slot) => {
          const selDate = opdType === 'General OPD' ? selectedGeneralDate : selectedPrivateDate;
          const timeIn24Hour = convertTo24HourFormat(slot);
          setAppointmentForm(prev => ({ ...prev, opdType, time: timeIn24Hour, date: selDate || today }));
          setSlotPreFilled(true); // lock date & time fields
          setView('form');
        };

        // Extract unique day names from schedule JSON + opd_days text
        const extractDays = (sched, dayStr) => {
          const days = new Set();
          if (Array.isArray(sched) && sched.length > 0) {
            sched.forEach(s => {
              const d = s.day || s.days || s.weekday || s.weekdays || '';
              parseDays(String(d)).forEach(x => days.add(x));
            });
          }
          if (days.size === 0 && dayStr) parseDays(dayStr).forEach(x => days.add(x));
          return [...days]; // ['Mon','Tue',...]
        };

        const gSched = Array.isArray(doc.general_opd_schedule) ? doc.general_opd_schedule : [];
        const pSched = Array.isArray(doc.private_opd_schedule) ? doc.private_opd_schedule : [];
        const generalDays = extractDays(gSched, doc.general_opd_days);
        const privateDays = extractDays(pSched, doc.private_opd_days);

        // Compute slots for selected OPD type and date from doctor data
        const slotsForDay = (sched, dayAbbr, fallbackStart, fallbackEnd, fallbackDur) => {
          if (Array.isArray(sched) && sched.length > 0) {
            // Find matching schedule entry for this day
            const matched = sched.find(s => {
              const d = s.day || s.days || s.weekday || s.weekdays || '';
              return parseDays(String(d)).includes(dayAbbr);
            });
            const entry = matched || (sched.length === 1 ? sched[0] : null);
            if (entry) {
              const st = entry.start || entry.start_time || entry.from || entry.startTime || fallbackStart;
              const en = entry.end || entry.end_time || entry.to || entry.endTime || fallbackEnd;
              const du = entry.duration || entry.slot_duration_minutes || entry.slotDuration || doc.slot_duration_minutes || fallbackDur || 15;
              if (st && en) return generateTimeSlots(st, en, Number(du));
            }
          }
          if (fallbackStart && fallbackEnd) return generateTimeSlots(fallbackStart, fallbackEnd, Number(fallbackDur || doc.slot_duration_minutes || 15));
          return [];
        };

        const generalSlots = (selectedGeneralDay && selectedGeneralDate)
          ? slotsForDay(gSched, selectedGeneralDay, doc.general_opd_start, doc.general_opd_end, doc.general_slot_duration_minutes)
          : [];
        const privateSlots = (selectedPrivateDay && selectedPrivateDate)
          ? slotsForDay(pSched, selectedPrivateDay, doc.private_opd_start, doc.private_opd_end, doc.private_slot_duration_minutes)
          : [];

        const hasAnyOPD = !!(doc.general_opd_days || doc.general_opd_start || gSched.length > 0 ||
          doc.private_opd_days || doc.private_opd_start || pSched.length > 0);

        return (
          <div className="bg-gray-50 min-h-screen pb-10">
            {/* Doctor mini-card */}
            <div className="bg-white mx-4 mt-4 rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
              <div className="flex-shrink-0">
                {imgUrl ? (
                  <img src={imgUrl} alt={doc.consultant_name}
                    className="w-14 h-14 rounded-xl object-cover border-2 border-indigo-100"
                    onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                ) : null}
                <div className="w-14 h-14 rounded-xl bg-indigo-50 border-2 border-indigo-100 flex items-center justify-center text-2xl"
                  style={{ display: imgUrl ? 'none' : 'flex' }}>ðŸ‘¨â€âš•ï¸</div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-sm">{doc.consultant_name}</p>
                <p className="text-indigo-600 text-xs">{doc.department}{doc.unit ? ` Â· ${doc.unit}` : ''}</p>
                {(doc.general_fee ?? doc.consultation_fee) && (
                  <p className="text-green-600 text-xs font-semibold mt-0.5">â‚¹{doc.general_fee ?? doc.consultation_fee} fee</p>
                )}
              </div>
            </div>

            <p className="text-sm font-bold text-gray-500 text-center mt-3 mb-1">Select a day then tap a slot</p>

            {/* â”€â”€ General OPD â”€â”€ */}
            {
              (generalDays.length > 0 || doc.general_opd_start) && (
                <div className="mx-4 mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 bg-green-50 border-b border-green-100">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
                      <p className="text-xs font-bold uppercase tracking-wider text-green-700">General OPD</p>
                      {(doc.general_fee ?? doc.consultation_fee) && (
                        <span className="ml-auto text-xs font-semibold text-green-600">â‚¹{doc.general_fee ?? doc.consultation_fee} fee</span>
                      )}
                    </div>
                    {(doc.general_opd_start || doc.general_opd_end) && (
                      <p className="text-[11px] text-green-500 mt-1 ml-4">â° {String(doc.general_opd_start || '').substring(0, 5)} â€“ {String(doc.general_opd_end || '').substring(0, 5)}</p>
                    )}
                  </div>
                  {generalDays.length > 0 && (
                    <div className="px-3 pt-3 pb-2 border-b border-gray-50">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Select Day</p>
                      <div className="flex flex-wrap gap-2">
                        {generalDays.map(day => (
                          <button key={day}
                            onClick={() => { setSelectedGeneralDay(d => d === day ? null : day); setSelectedGeneralDate(null); }}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${selectedGeneralDay === day
                              ? 'bg-green-500 text-white border-green-500 shadow-sm'
                              : 'bg-green-50 text-green-700 border-green-200 hover:border-green-400'
                              }`}
                          >{day}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedGeneralDay && (
                    <div className="px-3 pt-3 pb-2">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Select Date</p>
                      <div className="flex flex-wrap gap-2">
                        {getUpcomingDates(selectedGeneralDay).map(dt => (
                          <button key={dt.value}
                            onClick={() => setSelectedGeneralDate(d => d === dt.value ? null : dt.value)}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${selectedGeneralDate === dt.value
                              ? 'bg-green-500 text-white border-green-500 shadow-sm'
                              : 'bg-white text-green-700 border-green-200 hover:border-green-400'
                              }`}
                          >{dt.label}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedGeneralDay && selectedGeneralDate ? (
                    <div className="px-3 pb-3">
                      {generalSlots.length === 0
                        ? <p className="text-xs text-center text-gray-400 py-2">No slots found</p>
                        : <div className="grid grid-cols-3 gap-2">
                          {generalSlots.map(slot => (
                            <button key={slot}
                              onClick={() => handleSlotPick('General OPD', slot)}
                              className="py-2 rounded-lg text-[11px] font-semibold border-2 border-green-200 text-green-700 bg-green-50 hover:bg-green-500 hover:text-white hover:border-green-500 active:scale-95 transition-all"
                            >{slot}</button>
                          ))}
                        </div>
                      }
                    </div>
                  ) : (
                    !selectedGeneralDay
                      ? <p className="text-xs text-center text-gray-400 pb-4">â†‘ Select a day to continue</p>
                      : <p className="text-xs text-center text-gray-400 pb-4">â†‘ Select a date above to see slots</p>
                  )}
                </div>
              )
            }

            {/* â”€â”€ Private OPD â”€â”€ */}
            {
              (privateDays.length > 0 || doc.private_opd_start) && (
                <div className="mx-4 mt-4 mb-6 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 flex-shrink-0" />
                      <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Private OPD</p>
                      {(doc.private_fee ?? doc.consultation_fee) && (
                        <span className="ml-auto text-xs font-semibold text-indigo-600">â‚¹{doc.private_fee ?? doc.consultation_fee} fee</span>
                      )}
                    </div>
                    {(doc.private_opd_start || doc.private_opd_end) && (
                      <p className="text-[11px] text-indigo-500 mt-1 ml-4">â° {String(doc.private_opd_start || '').substring(0, 5)} â€“ {String(doc.private_opd_end || '').substring(0, 5)}</p>
                    )}
                  </div>
                  {privateDays.length > 0 && (
                    <div className="px-3 pt-3 pb-2 border-b border-gray-50">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Select Day</p>
                      <div className="flex flex-wrap gap-2">
                        {privateDays.map(day => (
                          <button key={day}
                            onClick={() => { setSelectedPrivateDay(d => d === day ? null : day); setSelectedPrivateDate(null); }}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${selectedPrivateDay === day
                              ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                              : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:border-indigo-400'
                              }`}
                          >{day}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedPrivateDay && (
                    <div className="px-3 pt-3 pb-2">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Select Date</p>
                      <div className="flex flex-wrap gap-2">
                        {getUpcomingDates(selectedPrivateDay).map(dt => (
                          <button key={dt.value}
                            onClick={() => setSelectedPrivateDate(d => d === dt.value ? null : dt.value)}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${selectedPrivateDate === dt.value
                              ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                              : 'bg-white text-indigo-700 border-indigo-200 hover:border-indigo-400'
                              }`}
                          >{dt.label}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedPrivateDay && selectedPrivateDate ? (
                    <div className="px-3 pb-3">
                      {privateSlots.length === 0
                        ? <p className="text-xs text-center text-gray-400 py-2">No slots found</p>
                        : <div className="grid grid-cols-3 gap-2">
                          {privateSlots.map(slot => (
                            <button key={slot}
                              onClick={() => handleSlotPick('Private OPD', slot)}
                              className="py-2 rounded-lg text-[11px] font-semibold border-2 border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 active:scale-95 transition-all"
                            >{slot}</button>
                          ))}
                        </div>
                      }
                    </div>
                  ) : (
                    !selectedPrivateDay
                      ? <p className="text-xs text-center text-gray-400 pb-4">â†‘ Select a day to continue</p>
                      : <p className="text-xs text-center text-gray-400 pb-4">â†‘ Select a date above to see slots</p>
                  )}
                </div>
              )
            }

            {/* No OPD data at all */}
            {
              !hasAnyOPD && (
                <div className="mx-4 mt-6 bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col items-center gap-3">
                  <span className="text-4xl">ðŸ“…</span>
                  <p className="font-semibold text-gray-700 text-sm">No slots configured</p>
                  <p className="text-gray-400 text-xs text-center">Slot timings not set for this doctor.</p>
                  <button onClick={() => setView('form')}
                    className="mt-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-md">
                    Book Manually
                  </button>
                </div>
              )
            }
          </div>
        );
      })()}

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ BOOKING FORM + BILLING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {(view === 'form' || view === 'billing') && (
        <div>
          {/* Form-only: Header + Error */}
          {view === 'form' && (
            <>
              {/* Header Section */}
              <div className="bg-white px-6 pt-6 pb-4">
                <div className="flex items-center gap-4">
                  <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
                    <Clock className="h-12 w-12 text-indigo-600" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-gray-800">Book Appointment</h1>
                    <p className="text-gray-500 text-sm font-medium">Book your Schedule your visit</p>
                  </div>
                </div>
              </div>
              {error && (
                <div className="mx-6 mb-4 p-4 bg-red-50 border-2 border-red-200 rounded-2xl flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-red-800 text-sm font-semibold">{error}</p>
                  </div>
                </div>
              )}
            </>
          )}
          {/* â”€â”€â”€ BILLING / SUMMARY PAGE (rendered inside form wrapper but controlled by billing view) â”€â”€â”€ */}
          {view === 'billing' && pendingAppointmentData && (
            <div className="pb-32">
              {/* Doctor card */}
              <div className="mx-4 mt-4 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  {pendingAppointmentData.doctor_image ? (
                    <img src={pendingAppointmentData.doctor_image} alt={pendingAppointmentData.doctor_name} className="w-14 h-14 rounded-full object-cover border-2 border-indigo-100" onError={e => { e.target.style.display = 'none'; }} />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center text-xl font-bold text-indigo-600 flex-shrink-0">
                      {pendingAppointmentData.doctor_name?.[0] || 'D'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-base leading-tight">{pendingAppointmentData.doctor_name}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{[pendingAppointmentData.doctor_designation, pendingAppointmentData.doctor_qualification].filter(Boolean).join(' Â· ') || pendingAppointmentData.department}</p>
                  </div>
                </div>
                <div className="space-y-2 pt-3 border-t border-gray-100 text-sm">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Calendar className="h-4 w-4 text-indigo-500 flex-shrink-0" />
                    <span>
                      {pendingAppointmentData.appointment_date
                        ? new Date(pendingAppointmentData.appointment_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
                        : ''}
                      {pendingAppointmentData.appointment_time ? `, ${String(pendingAppointmentData.appointment_time).substring(0, 5)}` : ''}
                    </span>
                  </div>
                  {pendingAppointmentData.hospital_name && (
                    <div className="flex items-start gap-2 text-gray-600">
                      <MapPin className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" />
                      <span>{pendingAppointmentData.hospital_name}{pendingAppointmentData.hospital_address ? `, ${pendingAppointmentData.hospital_address}` : ''}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Patient details */}
              <div className="mx-4 mt-3 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Patient Details</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Name</span>
                    <span className="font-semibold text-gray-900">{pendingAppointmentData.patient_name}</span>
                  </div>
                  {pendingAppointmentData.booking_for === 'family' && pendingAppointmentData.patient_relationship && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Relation</span>
                      <span className="font-semibold text-indigo-700">{pendingAppointmentData.patient_relationship}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Age / Gender</span>
                    <span className="font-semibold text-gray-900">{pendingAppointmentData.patient_age} yrs Â· {pendingAppointmentData.patient_gender}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Phone</span>
                    <span className="font-semibold text-gray-900">{pendingAppointmentData.patient_phone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Dept</span>
                    <span className="font-semibold text-gray-900">{pendingAppointmentData.department}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Reason</span>
                    <span className="font-semibold text-gray-900 text-right max-w-[60%]">{pendingAppointmentData.reason}</span>
                  </div>
                </div>
              </div>

              {/* Bill Details */}
              <div className="mx-4 mt-3 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Bill Details</p>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Consultation Fee</span>
                    <span className="font-semibold text-gray-900">
                      {pendingAppointmentData.consultation_fee ? `â‚¹${pendingAppointmentData.consultation_fee}` : 'To be informed'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Service Fee &amp; Tax</span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 line-through text-xs">â‚¹49</span>
                      <span className="text-green-600 font-bold text-xs bg-green-50 px-2 py-0.5 rounded-full">FREE</span>
                    </div>
                  </div>
                  <div className="border-t border-dashed border-gray-200 pt-2.5 flex justify-between items-center">
                    <span className="font-bold text-gray-900">Total Payable</span>
                    <span className="font-bold text-gray-900 text-base">
                      {pendingAppointmentData.consultation_fee ? `â‚¹${pendingAppointmentData.consultation_fee}` : 'â€”'}
                    </span>
                  </div>
                </div>

                {/* Promise */}
                <div className="mt-4 bg-green-50 rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-green-700 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Appointment confirmed instantly
                  </div>
                  <div className="flex items-center gap-2 text-xs text-green-700 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Details saved to your profile
                  </div>
                  <div className="flex items-center gap-2 text-xs text-green-700 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" /> No service charge applicable
                  </div>
                </div>
              </div>

              {/* Error on billing page */}
              {error && (
                <div className="mx-4 mt-3 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                  <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>
          )}


          {/* â”€â”€â”€ BILLING PAGE: sticky bottom bar â”€â”€â”€ */}
          {view === 'billing' && pendingAppointmentData && (
            <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 px-4 py-4 shadow-xl max-w-full md:max-w-[430px] md:mx-auto">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-gray-500">Total Payable</p>
                  <p className="text-xl font-bold text-gray-900">
                    {pendingAppointmentData.consultation_fee ? `â‚¹${pendingAppointmentData.consultation_fee}` : 'Pay at hospital'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setView('form')}
                  className="text-xs text-indigo-600 font-semibold underline"
                >
                  Edit Details
                </button>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmVisit}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold text-base active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-indigo-200"
              >
                {submitting ? (
                  <><div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" /> Booking...</>
                ) : (
                  <>âœ“ Confirm Clinic Visit</>
                )}
              </button>
            </div>
          )}

          {/* â”€â”€â”€ SUCCESS POPUP MODAL â”€â”€â”€ */}
          {showSuccessModal && bookedAppointmentData && (
            <div className="fixed inset-0 bg-black/50 z-[999] flex items-end justify-center p-0" onClick={(e) => { if (e.target === e.currentTarget) { } }}>
              <div className="bg-white w-full max-w-[430px] rounded-t-3xl shadow-2xl p-6 pb-8 animate-slide-up">
                {/* Green success banner */}
                <div className="bg-green-500 -mx-6 -mt-6 pt-8 pb-6 px-6 rounded-t-3xl mb-5 text-center">
                  <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 className="w-9 h-9 text-white" />
                  </div>
                  <h2 className="text-xl font-bold text-white">Appointment Booked!</h2>
                  <p className="text-green-100 text-sm mt-1">Your appointment is confirmed</p>
                  {bookedAppointmentData.id && (
                    <div className="mt-3 inline-block bg-white/20 rounded-xl px-4 py-1.5">
                      <p className="text-white text-xs font-medium">Appointment ID</p>
                      <p className="text-white text-lg font-bold">#{bookedAppointmentData.id}</p>
                    </div>
                  )}
                </div>

                {/* Quick details */}
                <div className="space-y-2 text-sm mb-5">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Patient</span>
                    <span className="font-semibold text-gray-900">{bookedAppointmentData.patient_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Doctor</span>
                    <span className="font-semibold text-gray-900 text-right max-w-[60%]">{bookedAppointmentData.doctor_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Date &amp; Time</span>
                    <span className="font-semibold text-gray-900">
                      {bookedAppointmentData.appointment_date ? new Date(bookedAppointmentData.appointment_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}
                      {bookedAppointmentData.appointment_time ? `, ${String(bookedAppointmentData.appointment_time).substring(0, 5)}` : ''}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Status</span>
                    <span className="text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded-full text-xs">â³ Pending</span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSuccessModal(false);
                      setBookedAppointmentData(null);
                      setPendingAppointmentData(null);
                      onNavigate('home');
                    }}
                    className="flex-1 py-3.5 bg-indigo-600 text-white rounded-2xl font-bold text-sm active:scale-95 transition-all"
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSuccessModal(false);
                      setView('history');
                      fetchAppointmentHistory();
                    }}
                    className="flex-1 py-3.5 bg-gray-100 text-gray-700 rounded-2xl font-bold text-sm active:scale-95 transition-all"
                  >
                    ðŸ“‹ View History
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* â”€â”€â”€ FORM BODY (hidden during billing view) â”€â”€â”€ */}
          {view === 'form' && (
            <div>
              {/* Booking For Toggle */}
              <div className="mb-6 px-6">

                <div className="flex bg-gray-100 p-1 rounded-2xl w-fit mx-auto">
                  <button
                    type="button"
                    className={`py-2 md:py-3 px-4 md:px-6 rounded-xl text-sm md:text-base font-semibold transition-all duration-300 ${appointmentForm.bookingFor === 'self'
                      ? 'bg-white text-indigo-600 shadow-md transform scale-105'
                      : 'text-gray-600 hover:text-indigo-500 hover:bg-gray-200'
                      }`}
                    onClick={() => {
                      setAppointmentForm({
                        ...appointmentForm,
                        bookingFor: 'self',
                        patientName: userData?.['Name'] || userData?.name || '',
                        phone: (userData?.['Mobile'] || userData?.mobile || '').substring(0, 15),
                        email: userData?.['Email'] || userData?.email || '',
                        age: '',
                        gender: '',
                        relationship: '',
                        relationshipText: '',
                        patientRelationship: 'Self'
                      });
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      For Self
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`py-2 md:py-3 px-4 md:px-6 rounded-xl text-sm md:text-base font-semibold transition-all duration-300 ${appointmentForm.bookingFor === 'family'
                      ? 'bg-white text-indigo-600 shadow-md transform scale-105'
                      : 'text-gray-600 hover:text-indigo-500 hover:bg-gray-200'
                      }`}
                    onClick={() => {
                      setSelectedFamilyMember(null);
                      setAppointmentForm({
                        ...appointmentForm,
                        bookingFor: 'family',
                        patientName: '',
                        phone: '',
                        email: '',
                        age: '',
                        gender: '',
                        relationship: '',
                        relationshipText: '',
                        patientRelationship: ''
                      });
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      For Family Member
                    </div>
                  </button>
                </div>
              </div>

              {/* Appointment Form */}
              <div className="px-4 py-2">
                <form onSubmit={handleSubmit} className="space-y-6 max-w-md mx-auto px-2">

                  {/* â”€â”€ Family Member Picker (For Family Member only) â”€â”€ */}
                  {appointmentForm.bookingFor === 'family' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                        Select Family Member
                      </label>

                      {familyMembers.length === 0 ? (
                        /* No members saved yet */
                        <div className="flex flex-col items-center gap-3 p-5 border-2 border-dashed border-indigo-200 rounded-2xl bg-indigo-50">
                          <div className="text-center">
                            <p className="text-sm font-semibold text-indigo-700">No family members added yet</p>
                            <p className="text-xs text-gray-500 mt-0.5">Save member details in your profile to auto-fill here</p>
                          </div>
                          <button
                            type="button"
                            disabled
                            className="px-4 py-2 bg-gray-300 text-gray-700 text-sm font-semibold rounded-xl cursor-not-allowed"
                          >
                            Family profiles unavailable
                          </button>
                        </div>
                      ) : (
                        /* Members list */
                        <div className="space-y-2">
                          {/* Selected chip */}
                          {selectedFamilyMember && (
                            <div className="flex items-center justify-between px-3 py-2 bg-indigo-50 border border-indigo-300 rounded-xl">
                              <span className="text-sm font-semibold text-indigo-800">
                                âœ“ {selectedFamilyMember.name}
                                {selectedFamilyMember.relation ? ` (${selectedFamilyMember.relation})` : ''}
                              </span>
                              <button
                                type="button"
                                onClick={handleClearFamilyMember}
                                className="text-xs text-gray-400 hover:text-red-500 ml-2 font-medium transition-colors"
                              >
                                âœ• Clear
                              </button>
                            </div>
                          )}

                          {/* Member cards */}
                          <div className="grid grid-cols-1 gap-2">
                            {familyMembers.map((member, idx) => {
                              const isSelected = selectedFamilyMember?.id === member.id ||
                                (selectedFamilyMember?.name === member.name && selectedFamilyMember?.relation === member.relation);
                              return (
                                <button
                                  key={member.id || idx}
                                  type="button"
                                  onClick={() => handleSelectFamilyMember(member)}
                                  className={`flex items-center gap-3 w-full text-left px-4 py-3 rounded-2xl border-2 transition-all active:scale-98 ${isSelected
                                    ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                                    : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-gray-50'
                                    }`}
                                >
                                  {/* Avatar */}
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0 ${isSelected ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-700'
                                    }`}>
                                    {member.name?.[0]?.toUpperCase() || '?'}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-gray-900 truncate">{member.name}</p>
                                    <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                      {member.relation && (
                                        <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-medium">{member.relation}</span>
                                      )}
                                      {member.gender && (
                                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{member.gender}</span>
                                      )}
                                      {(member.age || member.dob) && (
                                        <span className="text-xs text-gray-400">Age: {member.age || 'â€”'}</span>
                                      )}
                                    </div>
                                  </div>
                                  {isSelected && (
                                    <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
                                      <span className="text-white text-xs">âœ“</span>
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          {/* Add another member shortcut */}
                          <button
                            type="button"
                            disabled
                            className="flex items-center gap-1.5 text-xs text-gray-400 font-semibold ml-1 mt-1 cursor-not-allowed"
                          >
                            <span>+</span> Saved family profiles unavailable
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Patient Name - Editable based on booking for */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                      Patient Name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <User className="h-5 w-5 text-gray-400" />
                      </div>
                      <input
                        type="text"
                        required
                        value={appointmentForm.patientName}
                        onChange={(e) => setAppointmentForm({ ...appointmentForm, patientName: e.target.value })}
                        placeholder="Enter patient's full name"
                        className={`block w-full pl-11 pr-4 py-3.5 border rounded-2xl placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 transition-all text-sm font-medium ${appointmentForm.bookingFor === 'self' ? 'bg-gray-100 border-gray-300 text-gray-700 cursor-not-allowed' : 'bg-white border-gray-200 text-gray-800 focus:bg-white'
                          }`}
                        readOnly={appointmentForm.bookingFor === 'self'}
                      />
                    </div>
                  </div>

                  {/* Phone Number - Editable based on booking for */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                      Phone Number <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Phone className="h-5 w-5 text-gray-400" />
                      </div>
                      <input
                        type="tel"
                        required
                        value={appointmentForm.phone}
                        onChange={(e) => setAppointmentForm({ ...appointmentForm, phone: e.target.value.substring(0, 15) })}
                        placeholder="Patient's phone number"
                        className={`block w-full pl-11 pr-4 py-3.5 border rounded-2xl placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 transition-all text-sm font-medium ${appointmentForm.bookingFor === 'self' ? 'bg-gray-100 border-gray-300 text-gray-700 cursor-not-allowed' : 'bg-white border-gray-200 text-gray-800 focus:bg-white'
                          }`}
                        readOnly={appointmentForm.bookingFor === 'self'}
                      />
                    </div>
                  </div>

                  {/* Email - Editable based on booking for */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                      Email Address {appointmentForm.email ? '' : '(Optional)'}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Mail className="h-5 w-5 text-gray-400" />
                      </div>
                      <input
                        type="email"
                        value={appointmentForm.email || ''}
                        onChange={(e) => setAppointmentForm({ ...appointmentForm, email: e.target.value })}
                        placeholder="Patient's email address"
                        className={`block w-full pl-11 pr-4 py-3.5 border rounded-2xl placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 transition-all text-sm font-medium ${appointmentForm.bookingFor === 'self' && userData?.Email ? 'bg-gray-100 border-gray-300 text-gray-700' : 'bg-white border-gray-200 text-gray-800 focus:bg-white'
                          }`}
                        readOnly={appointmentForm.bookingFor === 'self' && !!userData?.Email}
                      />
                    </div>
                  </div>

                  {/* Relationship Field - Only shown when booking for family member */}
                  {appointmentForm.bookingFor === 'family' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                        Your Relationship to Patient <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <User className="h-5 w-5 text-gray-400" />
                        </div>
                        {appointmentForm.relationship === 'Other' ? (
                          <>
                            <input
                              type="text"
                              required
                              value={appointmentForm.relationshipText || ''}
                              onChange={(e) => setAppointmentForm({ ...appointmentForm, relationshipText: e.target.value })}
                              placeholder="Specify your relationship"
                              className="block w-full pl-11 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-sm font-medium"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const selectedRelationship = appointmentForm.relationshipText || 'Other';
                                setAppointmentForm({ ...appointmentForm, relationship: selectedRelationship, relationshipText: '' });
                              }}
                              className="absolute inset-y-0 right-0 pr-4 flex items-center text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                            >
                              Use
                            </button>
                          </>
                        ) : (
                          <>
                            <select
                              required
                              value={appointmentForm.relationship || ''}
                              onChange={(e) => {
                                if (e.target.value === 'Other') {
                                  setAppointmentForm({ ...appointmentForm, relationship: 'Other', relationshipText: '' });
                                } else {
                                  setAppointmentForm({ ...appointmentForm, relationship: e.target.value });
                                }
                              }}
                              className="block w-full pl-11 pr-10 py-3.5 bg-white border border-gray-200 rounded-2xl text-gray-800 appearance-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-sm font-medium"
                            >
                              <option value="">Select relationship</option>
                              <option value="Father">Father</option>
                              <option value="Mother">Mother</option>
                              <option value="Son">Son</option>
                              <option value="Daughter">Daughter</option>
                              <option value="Spouse">Spouse</option>
                              <option value="Brother">Brother</option>
                              <option value="Sister">Sister</option>
                              <option value="Grandfather">Grandfather</option>
                              <option value="Grandmother">Grandmother</option>
                              <option value="Uncle">Uncle</option>
                              <option value="Aunt">Aunt</option>
                              <option value="Cousin">Cousin</option>
                              <option value="Relative">Relative</option>
                              <option value="Friend">Friend</option>
                              <option value="Guardian">Guardian</option>
                              <option value="Other">Other</option>
                            </select>
                            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                              <ChevronRight className="h-5 w-5 text-gray-400 rotate-90" />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Select Doctor - shows pre-selected card if from listing, otherwise dropdown */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                      Selected Doctor <span className="text-red-500">*</span>
                    </label>

                    {/* Pre-selected doctor card (from listing page) */}
                    {selectedDoctor && appointmentForm.doctor ? (
                      <div className="bg-indigo-50 border-2 border-indigo-200 rounded-2xl p-4">
                        <div className="flex items-center gap-3">
                          {getDoctorImageUrl(selectedDoctor) ? (
                            <img
                              src={getDoctorImageUrl(selectedDoctor)}
                              alt={selectedDoctor.consultant_name}
                              className="w-14 h-14 rounded-xl object-cover border-2 border-indigo-100 flex-shrink-0"
                              onError={(e) => { e.target.style.display = 'none'; }}
                            />
                          ) : (
                            <div className="w-14 h-14 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-2xl">ðŸ‘¨â€âš•ï¸</span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-bold text-indigo-900 text-sm">{selectedDoctor.consultant_name}</p>
                              <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">âœ“ Selected</span>
                            </div>
                            {selectedDoctor.designation && (
                              <p className="text-indigo-600 text-xs font-medium mt-0.5">{selectedDoctor.designation}</p>
                            )}
                            <p className="text-indigo-700 text-xs mt-0.5">{selectedDoctor.department}</p>
                            {selectedDoctor.general_opd_days && (
                              <p className="text-gray-500 text-[10px] mt-1">
                                <span className="font-semibold">General OPD:</span> {selectedDoctor.general_opd_days}
                              </p>
                            )}
                            {selectedDoctor.private_opd_days && (
                              <p className="text-gray-500 text-[10px] mt-0.5">
                                <span className="font-semibold">Private OPD:</span> {selectedDoctor.private_opd_days}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Dropdown when no pre-selection */
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <Stethoscope className="h-5 w-5 text-gray-400" />
                        </div>
                        <select
                          required
                          name="doctor"
                          value={appointmentForm.doctor}
                          onChange={handleDoctorChange}
                          disabled={loading}
                          className="block w-full pl-11 pr-10 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 appearance-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <option key="default-doctor" value="">
                            {loading ? 'Loading doctors...' : 'Choose a doctor'}
                          </option>
                          {doctors.map((doc, index) => (
                            <option key={`${doc.id || doc.original_id || doc['S. No.'] || index}`} value={String(doc.original_id || doc.id || doc['S. No.'] || '')}>
                              {doc.consultant_name} - {doc.department || 'General'}
                            </option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                          <ChevronRight className="h-5 w-5 text-gray-400 rotate-90" />
                        </div>
                      </div>
                    )}

                    {/* Info panel shown when doctor selected via dropdown */}
                    {selectedDoctor && !appointmentForm.doctor && (
                      <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-xl">
                        <p className="text-xs font-semibold text-indigo-900">
                          {selectedDoctor.designation || selectedDoctor.specialization || 'Consultant'}
                        </p>
                        <p className="text-xs text-indigo-700 mt-1">
                          <strong>Department:</strong> {selectedDoctor.department || selectedDoctor['Company Name'] || 'N/A'}
                        </p>
                        <div className="mt-2 space-y-2">
                          {(selectedDoctor?.general_opd_days || selectedDoctor?.general_opd) && (
                            <div className="text-xs">
                              <strong className="text-indigo-900">General OPD:</strong>
                              <p className="text-indigo-700 mt-1">{selectedDoctor?.general_opd_days || selectedDoctor?.general_opd || 'N/A'}</p>
                            </div>
                          )}
                          {(selectedDoctor?.private_opd_days || selectedDoctor?.private_opd) && (
                            <div className="text-xs">
                              <strong className="text-indigo-900">Private OPD:</strong>
                              <p className="text-indigo-700 mt-1">{selectedDoctor?.private_opd_days || selectedDoctor?.private_opd || 'N/A'}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>




                  {/* OPD Type (Hidden Select for Form Validation) */}
                  <div className="hidden">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                      OPD Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      required={selectedDoctor && ((selectedDoctor?.general_opd_days || selectedDoctor?.general_opd) || (selectedDoctor?.private_opd_days || selectedDoctor?.private_opd))}
                      name="opdType"
                      value={appointmentForm.opdType || ''}
                      onChange={(e) => {
                        setAppointmentForm({ ...appointmentForm, opdType: e.target.value });
                        setDateError('');
                      }}
                      disabled={!selectedDoctor}
                      className="block w-full pl-11 pr-10 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 appearance-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option key="default-opd-type" value="">
                        {!selectedDoctor ? 'Select doctor first' : 'Select OPD type'}
                      </option>
                      {(selectedDoctor?.general_opd_days || selectedDoctor?.general_opd) && (
                        <option key="general-opd" value="General OPD">General OPD ({selectedDoctor?.general_opd_days || selectedDoctor?.general_opd})</option>
                      )}
                      {(selectedDoctor?.private_opd_days || selectedDoctor?.private_opd) && (
                        <option key="private-opd" value="Private OPD">Private OPD ({selectedDoctor?.private_opd_days || selectedDoctor?.private_opd})</option>
                      )}
                    </select>
                  </div>

                  {/* Date */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                      Date <span className="text-red-500">*</span>
                      {slotPreFilled && <span className="ml-2 text-green-600 text-[10px] font-semibold normal-case">âœ“ From slot</span>}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Calendar className="h-5 w-5 text-gray-400" />
                      </div>
                      <input
                        type="date"
                        required
                        min={new Date().toISOString().split('T')[0]}
                        value={appointmentForm.date}
                        onChange={slotPreFilled ? undefined : handleDateChange}
                        readOnly={slotPreFilled}
                        className={`block w-full pl-11 pr-4 py-3.5 border rounded-2xl text-sm font-medium transition-all ${slotPreFilled
                          ? 'bg-green-50 border-green-200 text-green-800 cursor-not-allowed'
                          : 'bg-gray-50 border-gray-200 text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white'
                          }`}
                      />
                    </div>
                    {dateError && (
                      <p className="text-red-600 text-xs mt-1 ml-1">{dateError}</p>
                    )}
                  </div>

                  {/* Time */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                      Time <span className="text-red-500">*</span>
                      {slotPreFilled && <span className="ml-2 text-green-600 text-[10px] font-semibold normal-case">âœ“ From slot</span>}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Clock className="h-5 w-5 text-gray-400" />
                      </div>
                      <input
                        type="time"
                        required
                        value={appointmentForm.time || ''}
                        onChange={slotPreFilled ? undefined : (e) => setAppointmentForm({ ...appointmentForm, time: e.target.value })}
                        readOnly={slotPreFilled}
                        className={`block w-full pl-11 pr-4 py-3.5 border rounded-2xl text-sm font-medium transition-all ${slotPreFilled
                          ? 'bg-green-50 border-green-200 text-green-800 cursor-not-allowed'
                          : 'bg-gray-50 border-gray-200 text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white'
                          }`}
                      />
                    </div>
                  </div>

                  {/* Age */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                      Age <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <User className="h-5 w-5 text-gray-400" />
                      </div>
                      <input
                        type="number"
                        required
                        min="1"
                        max="120"
                        value={appointmentForm.age || ''}
                        onChange={(e) => setAppointmentForm({ ...appointmentForm, age: e.target.value })}
                        placeholder="Enter age"
                        className="block w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-sm font-medium"
                      />
                    </div>
                  </div>

                  {/* Gender */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                      Gender <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <User className="h-5 w-5 text-gray-400" />
                      </div>
                      <select
                        name="gender"
                        required
                        value={appointmentForm.gender || ''}
                        onChange={(e) => setAppointmentForm({ ...appointmentForm, gender: e.target.value })}
                        className="block w-full pl-11 pr-10 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 appearance-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-sm font-medium"
                      >
                        <option value="">Select gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                      <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                        <ChevronRight className="h-5 w-5 text-gray-400 rotate-90" />
                      </div>
                    </div>
                  </div>

                  {/* First Visit Toggle */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                      Is this your first visit with this doctor?
                    </label>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setAppointmentForm({ ...appointmentForm, isFirstVisit: 'yes' })}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border-2 font-semibold text-sm transition-all active:scale-[0.98] ${appointmentForm.isFirstVisit === 'yes'
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-green-300 hover:bg-green-50'
                          }`}
                      >
                        <span className="text-base">{appointmentForm.isFirstVisit === 'yes' ? 'âœ…' : 'â¬œ'}</span>
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setAppointmentForm({ ...appointmentForm, isFirstVisit: 'no' })}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border-2 font-semibold text-sm transition-all active:scale-[0.98] ${appointmentForm.isFirstVisit === 'no'
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-indigo-300 hover:bg-indigo-50'
                          }`}
                      >
                        <span className="text-base">{appointmentForm.isFirstVisit === 'no' ? 'âœ…' : 'â¬œ'}</span>
                        No
                      </button>
                    </div>
                  </div>

                  {/* Appointment Type */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Appointment Type</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Calendar className="h-5 w-5 text-gray-400" />
                      </div>
                      <select
                        name="appointmentType"
                        value={appointmentForm.appointmentType || 'General Consultation'}
                        onChange={(e) => setAppointmentForm({ ...appointmentForm, appointmentType: e.target.value })}
                        className="block w-full pl-11 pr-10 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 appearance-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-sm font-medium"
                      >
                        <option value="General Consultation">General Consultation</option>
                        <option value="Follow-up">Follow-up</option>
                        <option value="Emergency">Emergency</option>
                        <option value="Routine Checkup">Routine Checkup</option>
                        <option value="Specialist Consultation">Specialist Consultation</option>
                      </select>
                      <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                        <ChevronRight className="h-5 w-5 text-gray-400 rotate-90" />
                      </div>
                    </div>
                  </div>

                  {/* Reason for Visit */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                      Reason for Visit <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      required
                      value={appointmentForm.reason}
                      onChange={(e) => setAppointmentForm({ ...appointmentForm, reason: e.target.value })}
                      placeholder="Briefly describe your symptoms or reason for visit..."
                      rows="3"
                      className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-sm font-medium resize-none"
                    />
                  </div>

                  {/* Medical History */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">
                      Previous Medical History (Optional)
                    </label>
                    <textarea
                      value={appointmentForm.medicalHistory || ''}
                      onChange={(e) => setAppointmentForm({ ...appointmentForm, medicalHistory: e.target.value })}
                      placeholder="Any previous medical conditions, allergies, or medications..."
                      rows="2"
                      className="block w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-sm font-medium resize-none"
                    />
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full mt-4 py-3 md:py-4 bg-indigo-600 text-white rounded-2xl font-bold text-base shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Booking Appointment...' : 'Confirm Appointment'}
                  </button>
                </form>
              </div>
              {/* Footer */}
              <footer className="mt-auto py-4 px-6 bg-gray-50 border-t border-gray-200">
                <div className="text-center">
                  <button
                    onClick={() => {
                      onNavigate('developers');
                    }}
                    className="text-xs text-gray-500 hover:text-indigo-600 font-medium transition-colors"
                  >
                    Powered by Developers
                  </button>
                </div>
              </footer>
            </div>
          )}
        </div>
      )}

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ APPOINTMENT HISTORY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {
        view === 'history' && (
          <div className="bg-gray-50 min-h-screen pb-10">
            <div className="px-4 pt-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-500 font-medium">
                  {historyLoading ? 'Loading...' : `${appointmentHistory.length} appointment${appointmentHistory.length !== 1 ? 's' : ''} found`}
                </p>
                <button
                  onClick={fetchAppointmentHistory}
                  className="flex items-center gap-1.5 text-xs text-indigo-600 font-semibold"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh
                </button>
              </div>

              {historyLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="bg-white rounded-2xl p-4 animate-pulse">
                      <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
                      <div className="h-3 bg-gray-200 rounded w-3/4 mb-2" />
                      <div className="h-3 bg-gray-200 rounded w-1/3" />
                    </div>
                  ))}
                </div>
              ) : appointmentHistory.length === 0 ? (
                <div className="bg-white rounded-2xl p-10 text-center">
                  <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Calendar className="w-8 h-8 text-indigo-300" />
                  </div>
                  <p className="font-semibold text-gray-700">No appointments yet</p>
                  <p className="text-gray-400 text-sm mt-1">Your booking history will appear here</p>
                  <button
                    onClick={() => setView('specialties')}
                    className="mt-4 px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold"
                  >
                    Book Now
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {appointmentHistory.map((appt) => {
                    const statusColor = {
                      pending: 'text-amber-600 bg-amber-50',
                      confirmed: 'text-green-600 bg-green-50',
                      cancelled: 'text-red-600 bg-red-50',
                      completed: 'text-indigo-600 bg-indigo-50',
                    }[appt.status?.toLowerCase()] || 'text-gray-600 bg-gray-50';
                    const StatusIcon = {
                      confirmed: CheckCircle2,
                      completed: CheckCircle2,
                      cancelled: XCircle,
                    }[appt.status?.toLowerCase()] || Clock;
                    return (
                      <div key={appt.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden relative">
                        {/* X (Delete) button at top-right */}
                        <button
                          disabled={processingId === appt.id}
                          onClick={() => setConfirmModal({ type: 'delete', appt })}
                          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 hover:bg-red-100 text-gray-400 hover:text-red-500 disabled:opacity-40 active:scale-90 transition-all z-10"
                          title="Delete record"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <div className="p-4 pr-12">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-gray-900 text-sm">{appt.doctor_name || 'Doctor'}</p>
                              <p className="text-indigo-600 text-xs mt-0.5">{appt.department || appt.opd_type || ''}</p>
                            </div>
                            <span className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${statusColor}`}>
                              <StatusIcon className="w-3 h-3" />
                              {(appt.status || 'Pending').charAt(0).toUpperCase() + (appt.status || 'pending').slice(1)}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            {appt.appointment_date && (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5" />
                                {new Date(appt.appointment_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </span>
                            )}
                            {appt.appointment_time && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                {appt.appointment_time.substring(0, 5)}
                              </span>
                            )}
                          </div>
                          {appt.patient_name && (
                            <p className="text-xs text-gray-400 mt-1">Patient: {appt.patient_name}</p>
                          )}
                          {appt.reason && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-1">Reason: {appt.reason}</p>
                          )}
                          {/* Cancel your Appointment button â€” only for pending or confirmed */}
                          {(appt.status?.toLowerCase() === 'pending' || appt.status?.toLowerCase() === 'confirmed' || !appt.status) && (
                            <div className="mt-3 pt-3 border-t border-gray-50">
                              <button
                                disabled={processingId === appt.id}
                                onClick={() => setConfirmModal({ type: 'cancel', appt })}
                                className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl font-semibold text-xs disabled:opacity-50 active:scale-[0.98] transition-all"
                              >
                                <XCircle className="w-4 h-4" />
                                {processingId === appt.id && cancellingAppointment ? 'Cancelling...' : 'Cancel your Appointment'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )
      }

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ CANCEL / DELETE CONFIRMATION MODAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {
        confirmModal && (
          <div
            className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
            onClick={(e) => { if (e.target === e.currentTarget) setConfirmModal(null); }}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setConfirmModal(null)} />

            {/* Modal Card */}
            <div className="relative w-full max-w-sm mx-4 mb-6 sm:mb-0 bg-white rounded-3xl shadow-2xl overflow-hidden animate-[slideUp_0.25s_ease]">
              {/* Top colored strip */}
              <div className={`h-1.5 w-full ${confirmModal.type === 'cancel' ? 'bg-orange-400' : 'bg-red-500'}`} />

              <div className="p-6">
                {/* Icon */}
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 ${confirmModal.type === 'cancel' ? 'bg-orange-50' : 'bg-red-50'
                  }`}>
                  {confirmModal.type === 'cancel'
                    ? <XCircle className="w-7 h-7 text-orange-500" />
                    : <Trash2 className="w-7 h-7 text-red-500" />
                  }
                </div>

                {/* Title */}
                <h3 className="text-lg font-bold text-gray-900 text-center mb-1">
                  {confirmModal.type === 'cancel' ? 'Cancel Appointment?' : 'Delete Record?'}
                </h3>

                {/* Description */}
                <p className="text-sm text-gray-500 text-center mb-1">
                  {confirmModal.type === 'cancel'
                    ? 'This appointment will be cancelled and you will receive a notification. The record will remain visible here.'
                    : 'This appointment record will be permanently deleted. This action cannot be undone.'}
                </p>

                {/* Appointment info */}
                <div className="bg-gray-50 rounded-2xl p-3 mt-4 mb-5 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400 font-medium">Doctor</span>
                    <span className="text-gray-800 font-semibold">{confirmModal.appt.doctor_name || 'â€”'}</span>
                  </div>
                  {confirmModal.appt.appointment_date && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400 font-medium">Date</span>
                      <span className="text-gray-800 font-semibold">
                        {new Date(confirmModal.appt.appointment_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                  {confirmModal.appt.appointment_time && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400 font-medium">Time</span>
                      <span className="text-gray-800 font-semibold">{confirmModal.appt.appointment_time.substring(0, 5)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400 font-medium">Patient</span>
                    <span className="text-gray-800 font-semibold">{confirmModal.appt.patient_name || 'â€”'}</span>
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => setConfirmModal(null)}
                    className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-2xl font-semibold text-sm hover:bg-gray-200 transition-colors active:scale-[0.98]"
                  >
                    No, Keep It
                  </button>
                  <button
                    disabled={processingId === confirmModal.appt.id}
                    onClick={() => {
                      if (confirmModal.type === 'cancel') {
                        handleCancelAppointment(
                          confirmModal.appt.id,
                          confirmModal.appt.patient_phone,
                          confirmModal.appt.doctor_name,
                          confirmModal.appt.appointment_date,
                          confirmModal.appt._fromSuccess || false
                        );
                      } else {
                        handleDeleteAppointment(confirmModal.appt.id);
                      }
                    }}
                    className={`flex-1 py-3 rounded-2xl font-semibold text-sm transition-colors active:scale-[0.98] disabled:opacity-60 text-white ${confirmModal.type === 'cancel'
                      ? 'bg-orange-500 hover:bg-orange-600'
                      : 'bg-red-500 hover:bg-red-600'
                      }`}
                  >
                    {processingId === confirmModal.appt.id
                      ? (confirmModal.type === 'cancel' ? 'Cancelling...' : 'Deleting...')
                      : (confirmModal.type === 'cancel' ? 'Yes, Cancel It' : 'Yes, Delete It')
                    }
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
};

export default Appointments;
