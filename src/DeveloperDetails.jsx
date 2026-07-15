import React, { useState, useEffect } from 'react';
import {
  ChevronLeft, Code2, Database, Palette,
  Mail, Phone, Copy, Check, Home as HomeIcon,
  Smartphone, Shield, Zap, Globe, MapPin, Sparkles,
  Github, Linkedin, ExternalLink, Star, Heart, Terminal,
  Layers, Cpu, Award
} from 'lucide-react';

const PHONE   = '9312234636';
const EMAIL   = 'thermal.aig@gmail.com';
const ADDRESS = '4TH FLOOR, C-57, TEI TOWER, WAZIRPUR INDUSTRIAL AREA, New Delhi, North West Delhi, Delhi, 110052';

const team = [
  {
    initials: 'FD',
    name: 'Frontend Developer',
    role: 'React & Mobile App Specialist',
    icon: Code2,
    gradient: 'from-blue-500 to-cyan-500',
    glowColor: 'shadow-blue-200',
    borderColor: 'border-blue-100',
    bgColor: 'bg-blue-50',
    tagBg: 'bg-blue-100 text-blue-700',
    description: 'Building responsive, modern UIs and mobile experiences using React and Capacitor.',
    skills: ['React', 'JavaScript', 'Mobile Dev', 'UI/UX'],
    experience: '3+ Years',
  },
  {
    initials: 'BD',
    name: 'Backend Developer',
    role: 'Node.js & API Architect',
    icon: Database,
    gradient: 'from-emerald-500 to-teal-500',
    glowColor: 'shadow-emerald-200',
    borderColor: 'border-emerald-100',
    bgColor: 'bg-emerald-50',
    tagBg: 'bg-emerald-100 text-emerald-700',
    description: 'Designing scalable APIs, managing databases and server-side performance.',
    skills: ['Node.js', 'Express', 'PostgreSQL', 'REST APIs'],
    experience: '4+ Years',
  },
  {
    initials: 'DS',
    name: 'UI/UX Designer',
    role: 'Design & User Experience',
    icon: Palette,
    gradient: 'from-violet-500 to-purple-500',
    glowColor: 'shadow-violet-200',
    borderColor: 'border-violet-100',
    bgColor: 'bg-violet-50',
    tagBg: 'bg-violet-100 text-violet-700',
    description: 'Crafting intuitive, clean designs with focus on usability and user research.',
    skills: ['UI Design', 'Figma', 'Prototyping', 'UX Research'],
    experience: '3+ Years',
  },
];

const features = [
  { icon: Zap,        label: 'Fast',      description: 'Optimized performance', gradient: 'from-amber-400 to-orange-500' },
  { icon: Shield,     label: 'Secure',    description: 'Enterprise security',   gradient: 'from-emerald-400 to-teal-500' },
  { icon: Smartphone, label: 'Mobile',    description: 'Native experience',     gradient: 'from-blue-400 to-indigo-500' },
  { icon: Globe,      label: 'Real-time', description: 'Live data sync',        gradient: 'from-violet-400 to-purple-500' },
];

const stats = [
  { value: '10+', label: 'Modules Built', icon: Layers },
  { value: '99%', label: 'Uptime',        icon: Cpu   },
  { value: '24/7', label: 'Support',      icon: Heart },
  { value: '5★',  label: 'Quality',       icon: Award },
];

// Animated star particles for hero
const PARTICLES = Array.from({ length: 22 }, (_, i) => ({
  id: i,
  x: Math.round(3 + (i * 19) % 93),
  y: Math.round(4 + (i * 27) % 90),
  size: i % 4 === 0 ? 3 : i % 4 === 1 ? 2.5 : i % 4 === 2 ? 2 : 1.5,
  dur: 2.5 + (i % 6) * 0.6,
  delay: (i * 0.25) % 3.5,
  opacity: 0.12 + (i % 5) * 0.07,
}));

const DeveloperDetails = ({ onNavigateBack, onNavigate }) => {
  const [copiedEmail, setCopiedEmail]     = useState(false);
  const [copiedPhone, setCopiedPhone]     = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [activeCard, setActiveCard]       = useState(null);
  const [mounted, setMounted]             = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const copyText = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'email')   { setCopiedEmail(true);   setTimeout(() => setCopiedEmail(false),   2000); }
      else if (type === 'phone')   { setCopiedPhone(true);   setTimeout(() => setCopiedPhone(false),   2000); }
      else if (type === 'address') { setCopiedAddress(true); setTimeout(() => setCopiedAddress(false), 2000); }
    } catch { }
  };

  return (
    <div
      className="bg-slate-950 min-h-screen flex flex-col"
      style={{ fontFamily: "'Inter', 'DM Sans', sans-serif" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50%       { opacity: 0.65; transform: scale(1.1); }
        }
        @keyframes floatDev {
          0%, 100% { transform: translateY(0px) rotate(-1.5deg); }
          50%       { transform: translateY(-12px) rotate(1.5deg); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        @keyframes gridFlow {
          from { background-position: 0 0; }
          to   { background-position: 40px 40px; }
        }
        @keyframes twinkle {
          0%, 100% { opacity: 0.15; transform: scale(0.8); }
          50%       { opacity: 1; transform: scale(1.3); }
        }
        @keyframes devGlow {
          0%, 100% { filter: drop-shadow(0 0 12px rgba(99,102,241,0.5)); }
          50%       { filter: drop-shadow(0 0 28px rgba(99,102,241,0.85)) drop-shadow(0 0 10px rgba(139,92,246,0.6)); }
        }

        .fade-up { animation: fadeSlideUp 0.55s cubic-bezier(0.22,1,0.36,1) both; }
        .delay-1 { animation-delay: 0.08s; }
        .delay-2 { animation-delay: 0.16s; }
        .delay-3 { animation-delay: 0.24s; }
        .delay-4 { animation-delay: 0.32s; }
        .delay-5 { animation-delay: 0.40s; }
        .delay-6 { animation-delay: 0.48s; }

        .orb { animation: pulse-slow 4s ease-in-out infinite; }
        .orb2 { animation: pulse-slow 5.5s ease-in-out infinite; animation-delay: 1.8s; }
        .orb3 { animation: pulse-slow 3.5s ease-in-out infinite; animation-delay: 0.9s; }
        .float-dev { animation: floatDev 3.8s ease-in-out infinite; }
        .dev-glow { animation: devGlow 3s ease-in-out infinite; }
        .particle { animation: twinkle var(--pdur, 3s) ease-in-out infinite; animation-delay: var(--pdel, 0s); }
        .hero-grid {
          background-image:
            linear-gradient(rgba(99,102,241,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,102,241,0.06) 1px, transparent 1px);
          background-size: 40px 40px;
          animation: gridFlow 9s linear infinite;
        }

        /* ── Active Boy Move Animation ── */
        @keyframes activeMove {
          0%, 100% { transform: translateY(0px) rotate(-1.5deg) scale(1); }
          30%       { transform: translateY(-14px) rotate(2deg) scale(1.05); }
          60%       { transform: translateY(4px) rotate(-1deg) scale(0.97); }
          85%       { transform: translateY(-6px) rotate(1.5deg) scale(1.02); }
        }
        @keyframes screenFlicker {
          0%, 100% { box-shadow: 0 0 24px 6px rgba(99,102,241,0.45), 0 0 60px 12px rgba(99,102,241,0.2); }
          20%       { box-shadow: 0 0 32px 10px rgba(99,102,241,0.65), 0 0 70px 18px rgba(99,102,241,0.3); }
          40%       { box-shadow: 0 0 20px 4px rgba(99,102,241,0.35), 0 0 50px 8px rgba(99,102,241,0.15); }
          60%       { box-shadow: 0 0 36px 12px rgba(139,92,246,0.55), 0 0 80px 20px rgba(139,92,246,0.25); }
          80%       { box-shadow: 0 0 28px 8px rgba(99,102,241,0.5), 0 0 65px 15px rgba(99,102,241,0.22); }
        }
        @keyframes floatCode1 {
          0%, 100% { transform: translateY(0) translateX(0) rotate(-8deg); opacity: 0.7; }
          50%       { transform: translateY(-10px) translateX(4px) rotate(-4deg); opacity: 1; }
        }
        @keyframes floatCode2 {
          0%, 100% { transform: translateY(0) translateX(0) rotate(6deg); opacity: 0.6; }
          50%       { transform: translateY(-8px) translateX(-3px) rotate(10deg); opacity: 0.9; }
        }
        @keyframes floatCode3 {
          0%, 100% { transform: translateY(0) rotate(-12deg); opacity: 0.5; }
          50%       { transform: translateY(-12px) rotate(-6deg); opacity: 0.85; }
        }
        .typing-char { animation: activeMove 3.5s ease-in-out infinite; }
        .screen-glow { animation: screenFlicker 2.8s ease-in-out infinite; border-radius: 50%; }
        .code-tag1 { animation: floatCode1 2.6s ease-in-out infinite; }
        .code-tag2 { animation: floatCode2 3.1s ease-in-out infinite; animation-delay: 0.5s; }
        .code-tag3 { animation: floatCode3 2.4s ease-in-out infinite; animation-delay: 1s; }

        .shimmer-text {
          background: linear-gradient(90deg, #fff 0%, #a5b4fc 40%, #fff 60%, #6ee7b7 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 3s linear infinite;
        }

        .glass-card {
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .glass-card-light {
          background: rgba(255,255,255,0.97);
          border: 1px solid rgba(0,0,0,0.06);
        }

        .team-card:hover { transform: translateY(-3px); box-shadow: 0 20px 60px rgba(0,0,0,0.15); }
        .team-card { transition: all 0.3s cubic-bezier(0.34,1.56,0.64,1); }

        .tech-pill:hover { transform: scale(1.06); }
        .tech-pill { transition: transform 0.2s ease; }

        .contact-row:hover { background: rgba(249,250,251,1); }
        .contact-row { transition: background 0.2s ease; }

        .stat-card {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          transition: all 0.25s ease;
        }
        .stat-card:hover {
          background: rgba(255,255,255,0.09);
          transform: translateY(-2px);
        }
      `}</style>

      {/* ── Navbar ── */}
      <div className="bg-slate-950/90 backdrop-blur-xl border-b border-white/[0.06] px-5 py-4 flex items-center justify-between sticky top-0 z-50" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)' }}>
        <button
          onClick={onNavigateBack}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] transition-colors border border-white/[0.08]"
        >
          <ChevronLeft className="h-4 w-4 text-slate-300" />
          <span className="text-sm font-medium text-slate-300">Back</span>
        </button>
        <h1 className="text-sm font-bold text-white tracking-tight">Developer Team</h1>
        <button
          onClick={() => onNavigate('home')}
          className="p-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] transition-colors border border-white/[0.08]"
        >
          <HomeIcon className="h-4 w-4 text-slate-300" />
        </button>
      </div>

      {/* ── Hero Section ── */}
      <div className="relative overflow-hidden bg-slate-950 px-5 pt-8 pb-16 text-center">
        {/* Animated grid */}
        <div className="hero-grid absolute inset-0 pointer-events-none" />

        {/* Background orbs */}
        <div className="orb absolute -top-24 -right-20 w-72 h-72 rounded-full bg-indigo-600/25 blur-3xl pointer-events-none" />
        <div className="orb2 absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-violet-600/20 blur-3xl pointer-events-none" />
        <div className="orb3 absolute top-1/2 left-1/4 w-52 h-52 rounded-full bg-cyan-600/15 blur-3xl pointer-events-none" />
        <div className="orb absolute bottom-0 right-1/4 w-44 h-44 rounded-full bg-fuchsia-600/10 blur-2xl pointer-events-none" style={{ animationDelay: '3s' }} />

        {/* Floating particles */}
        {PARTICLES.map(p => (
          <div
            key={p.id}
            className="particle absolute rounded-full bg-indigo-300"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              opacity: p.opacity,
              '--pdur': `${p.dur}s`,
              '--pdel': `${p.delay}s`,
            }}
          />
        ))}

        {/* ── Developer Character Image ── */}
        <div
          className={`relative mx-auto mb-2 ${mounted ? 'fade-up' : 'opacity-0'}`}
          style={{ width: 140, height: 140 }}
        >
          {/* Floating code badges */}
          <div className="code-tag1 absolute -left-4 top-4 bg-indigo-600 text-white text-[9px] font-mono font-bold px-2 py-0.5 rounded z-20 shadow-sm pointer-events-none">&lt;/&gt;</div>
          <div className="code-tag2 absolute -right-3 top-2 bg-cyan-500 text-slate-900 text-[9px] font-mono font-bold px-2 py-0.5 rounded z-20 shadow-sm pointer-events-none">fn()</div>
          <div className="code-tag3 absolute -right-1 bottom-4 bg-violet-600 text-white text-[9px] font-mono font-bold px-2 py-0.5 rounded z-20 shadow-sm pointer-events-none">const</div>
          <div className="code-tag1 absolute -left-2 bottom-6 bg-emerald-600 text-white text-[9px] font-mono font-bold px-2 py-0.5 rounded z-20 shadow-sm pointer-events-none" style={{animationDelay:'1s'}}>{'{=>'}</div>

          {/* Glow pulse behind */}
          <div
            className="screen-glow absolute inset-0 rounded-3xl pointer-events-none z-0"
            style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.5) 0%, transparent 70%)' }}
          />

          {/* Dark container clips white frame edges — scale(1.13) zooms past the white border */}
          <div
            className="typing-char relative w-full h-full rounded-3xl overflow-hidden z-10"
            style={{ background: '#0c1225' }}
          >
            <img
              src="/dev_character.png"
              alt="Developer working"
              className="w-full h-full"
              style={{
                objectFit: 'cover',
                objectPosition: 'center',
                transform: 'scale(1.1) translateY(2%)',
              }}
            />
          </div>
        </div>

        {/* Title */}
        <div className={`${mounted ? 'fade-up delay-1' : 'opacity-0'}`}>
          <h1 className="text-3xl font-black tracking-tight mb-1">
            <span className="shimmer-text">People Behind</span>
            <br />
            <span className="text-white">The Product</span>
          </h1>
          <p className="text-slate-400 text-sm mt-3 leading-relaxed max-w-xs mx-auto">
            Design, engineering and operations — working in perfect harmony.
          </p>
          <div className="inline-flex items-center gap-2 mt-4 px-4 py-1.5 rounded-full border border-white/10 bg-white/[0.05] text-xs font-semibold text-slate-300">
            <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
            Care • Craft • Reliability
          </div>
        </div>
      </div>

      {/* ── Main content sheet ── */}
      <div className="bg-slate-50 rounded-t-3xl -mt-8 flex-1 px-4 pt-6 pb-14 space-y-5">

        {/* Stats row */}
        <div className={`grid grid-cols-4 gap-2 ${mounted ? 'fade-up delay-2' : 'opacity-0'}`}>
          {stats.map(({ value, label, icon: Icon }) => (
            <div key={label} className="bg-white rounded-2xl p-3 text-center shadow-sm border border-slate-100 flex flex-col items-center gap-1 transition-all hover:-translate-y-0.5 hover:shadow-md cursor-default">
              <Icon className="h-4 w-4 text-indigo-500 mb-0.5" />
              <span className="text-base font-black text-slate-800 leading-none">{value}</span>
              <span className="text-[9px] font-semibold text-slate-400 leading-tight text-center">{label}</span>
            </div>
          ))}
        </div>

        {/* ── Contact Support — FIRST (after stats) ── */}
        <div className={`bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm ${mounted ? 'fade-up delay-2' : 'opacity-0'}`}>
          <div className="px-5 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-100 flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-sm">
              <Phone className="h-4 w-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Contact Support</h2>
              <p className="text-[11px] text-indigo-500 font-medium">We're here to help anytime</p>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            <a href={`mailto:${EMAIL}`} className="contact-row flex items-center gap-3 px-5 py-4 transition-colors">
              <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                <Mail className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Email</p>
                <p className="text-sm font-semibold text-slate-700 truncate">{EMAIL}</p>
              </div>
              <button onClick={(e) => { e.preventDefault(); copyText(EMAIL, 'email'); }}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0 border ${
                  copiedEmail ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200 active:scale-95'}`}>
                {copiedEmail ? <><Check className="h-3 w-3" /> Done</> : <><Copy className="h-3 w-3" /> Copy</>}
              </button>
            </a>
            <a href={`tel:+91${PHONE}`} className="contact-row flex items-center gap-3 px-5 py-4 transition-colors">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                <Phone className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Phone</p>
                <p className="text-sm font-semibold text-slate-700">+91 {PHONE}</p>
              </div>
              <button onClick={(e) => { e.preventDefault(); copyText(`+91 ${PHONE}`, 'phone'); }}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0 border ${
                  copiedPhone ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200 active:scale-95'}`}>
                {copiedPhone ? <><Check className="h-3 w-3" /> Done</> : <><Copy className="h-3 w-3" /> Copy</>}
              </button>
            </a>
            <div className="contact-row flex items-start gap-3 px-5 py-4 transition-colors">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm mt-0.5">
                <MapPin className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Address</p>
                <p className="text-sm font-semibold text-slate-700 leading-relaxed">{ADDRESS}</p>
              </div>
              <button onClick={() => copyText(ADDRESS, 'address')}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0 border mt-0.5 ${
                  copiedAddress ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200 active:scale-95'}`}>
                {copiedAddress ? <><Check className="h-3 w-3" /> Done</> : <><Copy className="h-3 w-3" /> Copy</>}
              </button>
            </div>
          </div>
        </div>

        {/* Feature cards */}
        <div className={`grid grid-cols-2 gap-3 ${mounted ? 'fade-up delay-2' : 'opacity-0'}`}>
          {features.map(({ icon: Icon, label, description, gradient }) => (
            <div
              key={label}
              className="relative overflow-hidden bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-center gap-3"
            >
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-sm flex-shrink-0`}>
                <Icon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">{label}</p>
                <p className="text-[10px] text-slate-400 font-medium">{description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Team Cards */}
        <div className={`${mounted ? 'fade-up delay-4' : 'opacity-0'}`}>
          <div className="flex items-center gap-2 mb-3 ml-1">
            <div className="w-1 h-4 bg-gradient-to-b from-indigo-500 to-purple-500 rounded-full" />
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Our Team</h2>
          </div>
          <div className="space-y-3">
            {team.map((dev, idx) => (
              <div
                key={dev.name}
                className={`team-card bg-white rounded-2xl border ${dev.borderColor} shadow-sm overflow-hidden`}
                style={{ animationDelay: `${0.44 + idx * 0.08}s` }}
              >
                {/* Gradient bar at top */}
                <div className={`h-1 w-full bg-gradient-to-r ${dev.gradient}`} />
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                      <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${dev.gradient} flex items-center justify-center shadow-lg`}>
                        <span className="text-lg font-black text-white">{dev.initials}</span>
                      </div>
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100">
                        <dev.icon className="h-3 w-3 text-slate-600" />
                      </div>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-slate-800 text-sm leading-tight">{dev.name}</h3>
                          <p className="text-slate-400 text-xs mt-0.5 font-medium">{dev.role}</p>
                        </div>
                        <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${dev.tagBg}`}>
                          {dev.experience}
                        </span>
                      </div>
                      <p className="text-slate-500 text-xs mt-2.5 leading-relaxed">{dev.description}</p>
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {dev.skills.map(skill => (
                          <span key={skill} className={`px-2.5 py-1 text-[10px] font-semibold rounded-full ${dev.tagBg}`}>
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>



        {/* Footer brand */}
        <div className={`text-center pt-2 pb-2 ${mounted ? 'fade-up delay-6' : 'opacity-0'}`}>
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Heart className="h-3.5 w-3.5 text-rose-400 fill-rose-400" />
            <span className="text-xs font-semibold text-slate-400">Built with care in India</span>
          </div>
          <p className="text-[10px] text-slate-300 font-medium">© 2025 Thermal AIG · All rights reserved</p>
        </div>
      </div>
    </div>
  );
};

export default DeveloperDetails;
