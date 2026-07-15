// ============================================================
// EXAMPLE: Modal Handling with Android Back Button
// 
// यह file दिखाती है कि modal को properly back button के साथ
// कैसे handle करते हैं
// ============================================================

import React, { useState, useEffect } from 'react';
import { useAndroidBack } from './hooks';

/**
 * Example 1: Simple Modal
 */
export function SimpleModalExample() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { registerModalCleanup } = useAndroidBack();

  // Back button handler - modal को पहले close करो
  useEffect(() => {
    if (isModalOpen) {
      registerModalCleanup(() => {
        console.log('📱 Back दबा - Modal बंद हो रहा है');
        setIsModalOpen(false);
      });
    }
  }, [isModalOpen, registerModalCleanup]);

  return (
    <div className="p-4">
      <h1>Simple Modal Example</h1>
      
      <button 
        onClick={() => setIsModalOpen(true)}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        Modal खोलो
      </button>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg">
            <h2>Modal Title</h2>
            <p>कुछ content यहाँ है</p>
            
            <div className="flex gap-2 mt-4">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded"
              >
                बंद करो
              </button>
              <button 
                className="px-4 py-2 bg-green-500 text-white rounded"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Example 2: Filter Modal (Common in Directory/Search pages)
 */
export function FilterModalExample() {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filters, setFilters] = useState({
    category: '',
    location: '',
    rating: 0
  });
  const { registerModalCleanup } = useAndroidBack();

  // Filter modal बंद करने के लिए back handler
  useEffect(() => {
    if (isFilterOpen) {
      registerModalCleanup(() => {
        console.log('📱 Back दबा - Filter modal बंद हो रहा है');
        setIsFilterOpen(false);
      });
    }
  }, [isFilterOpen, registerModalCleanup]);

  const handleApplyFilters = () => {
    console.log('Filters applied:', filters);
    setIsFilterOpen(false);
  };

  return (
    <div className="p-4">
      <h1>Search with Filters</h1>

      <button 
        onClick={() => setIsFilterOpen(true)}
        className="px-4 py-2 bg-indigo-600 text-white rounded"
      >
        🔍 Filter खोलो
      </button>

      {isFilterOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-96">
            <h2 className="text-xl font-bold mb-4">Filter Options</h2>

            <div className="space-y-4">
              <div>
                <label className="block mb-2">Category</label>
                <select 
                  value={filters.category}
                  onChange={(e) => setFilters({...filters, category: e.target.value})}
                  className="w-full border rounded p-2"
                >
                  <option value="">All Categories</option>
                  <option value="doctor">Doctors</option>
                  <option value="hospital">Hospitals</option>
                  <option value="clinic">Clinics</option>
                </select>
              </div>

              <div>
                <label className="block mb-2">Location</label>
                <input 
                  type="text"
                  value={filters.location}
                  onChange={(e) => setFilters({...filters, location: e.target.value})}
                  placeholder="Enter location"
                  className="w-full border rounded p-2"
                />
              </div>

              <div>
                <label className="block mb-2">Min Rating: {filters.rating}⭐</label>
                <input 
                  type="range"
                  min="0"
                  max="5"
                  value={filters.rating}
                  onChange={(e) => setFilters({...filters, rating: parseInt(e.target.value)})}
                  className="w-full"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button 
                onClick={() => setIsFilterOpen(false)}
                className="flex-1 px-4 py-2 bg-gray-500 text-white rounded"
              >
                Cancel
              </button>
              <button 
                onClick={handleApplyFilters}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Example 3: Multiple Modals (Complex case)
 */
export function MultipleModalsExample() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { registerModalCleanup } = useAndroidBack();

  // Search modal handler
  useEffect(() => {
    if (searchOpen) {
      registerModalCleanup(() => {
        console.log('📱 Back - सर्च बंद');
        setSearchOpen(false);
      });
    }
  }, [searchOpen, registerModalCleanup]);

  // Filter modal handler
  useEffect(() => {
    if (filterOpen) {
      registerModalCleanup(() => {
        console.log('📱 Back - फ़िल्टर बंद');
        setFilterOpen(false);
      });
    }
  }, [filterOpen, registerModalCleanup]);

  // Details modal handler
  useEffect(() => {
    if (detailsOpen) {
      registerModalCleanup(() => {
        console.log('📱 Back - डिटेल्स बंद');
        setDetailsOpen(false);
      });
    }
  }, [detailsOpen, registerModalCleanup]);

  return (
    <div className="p-4">
      <h1>Directory with Multiple Modals</h1>

      <div className="flex gap-2 mb-4">
        <button 
          onClick={() => setSearchOpen(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          🔍 Search
        </button>
        <button 
          onClick={() => setFilterOpen(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded"
        >
          ⚙️ Filter
        </button>
        <button 
          onClick={() => setDetailsOpen(true)}
          className="px-4 py-2 bg-green-600 text-white rounded"
        >
          ℹ️ Details
        </button>
      </div>

      {/* Search Modal */}
      {searchOpen && (
        <Modal title="Search" onClose={() => setSearchOpen(false)}>
          <input 
            type="text" 
            placeholder="Search..." 
            className="w-full border rounded p-2"
          />
        </Modal>
      )}

      {/* Filter Modal */}
      {filterOpen && (
        <Modal title="Filter" onClose={() => setFilterOpen(false)}>
          <div className="space-y-3">
            <label className="flex items-center">
              <input type="checkbox" className="mr-2" />
              Verified Only
            </label>
            <label className="flex items-center">
              <input type="checkbox" className="mr-2" />
              Available Today
            </label>
          </div>
        </Modal>
      )}

      {/* Details Modal */}
      {detailsOpen && (
        <Modal title="Details" onClose={() => setDetailsOpen(false)}>
          <p>कुछ detailed information यहाँ है</p>
        </Modal>
      )}
    </div>
  );
}

/**
 * Reusable Modal Component
 */
function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full mx-4 max-w-md">
        <div className="flex justify-between items-center border-b p-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button 
            onClick={onClose}
            className="text-2xl text-gray-500"
          >
            ✕
          </button>
        </div>
        <div className="p-4">
          {children}
        </div>
        <div className="border-t p-4 flex gap-2">
          <button 
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-500 text-white rounded"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Example 4: Form with Confirmation Dialog
 */
export function FormWithConfirmationExample() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { registerModalCleanup } = useAndroidBack();

  useEffect(() => {
    if (confirmOpen) {
      registerModalCleanup(() => {
        console.log('📱 Back - Confirmation बंद');
        setConfirmOpen(false);
      });
    }
  }, [confirmOpen, registerModalCleanup]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setConfirmOpen(true);
  };

  return (
    <div className="p-4">
      <h1>Form with Confirmation</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input 
          type="text" 
          placeholder="Name" 
          className="w-full border rounded p-2"
          required 
        />
        <input 
          type="email" 
          placeholder="Email" 
          className="w-full border rounded p-2"
          required 
        />
        <button 
          type="submit"
          className="w-full px-4 py-2 bg-blue-600 text-white rounded"
        >
          Submit
        </button>
      </form>

      {confirmOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-sm">
            <h2 className="text-lg font-bold mb-4">Confirm Submission?</h2>
            <p className="text-gray-600 mb-6">क्या आप form submit करना चाहते हो?</p>
            
            <div className="flex gap-2">
              <button 
                onClick={() => setConfirmOpen(false)}
                className="flex-1 px-4 py-2 bg-gray-500 text-white rounded"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  console.log('Form submitted');
                  setConfirmOpen(false);
                }}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Example 5: Real-world Directory Page
 */
export function DirectoryPageExample() {
  const [members] = useState([
    { id: 1, name: 'Dr. Rajesh Kumar', specialty: 'Cardiology' },
    { id: 2, name: 'Dr. Priya Singh', specialty: 'Pediatrics' },
    { id: 3, name: 'Dr. Amit Patel', specialty: 'Orthopedics' },
  ]);
  
  const [selectedMember, setSelectedMember] = useState(null);
  const { registerModalCleanup } = useAndroidBack();

  useEffect(() => {
    if (selectedMember) {
      registerModalCleanup(() => {
        console.log('📱 Back - Member details बंद');
        setSelectedMember(null);
      });
    }
  }, [selectedMember, registerModalCleanup]);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Healthcare Directory</h1>

      <div className="space-y-3">
        {members.map((member) => (
          <div 
            key={member.id}
            onClick={() => setSelectedMember(member)}
            className="p-4 border rounded cursor-pointer hover:bg-gray-50"
          >
            <h3 className="font-bold">{member.name}</h3>
            <p className="text-gray-600">{member.specialty}</p>
          </div>
        ))}
      </div>

      {selectedMember && (
        <Modal 
          title={selectedMember.name}
          onClose={() => setSelectedMember(null)}
        >
          <div className="space-y-2">
            <p><strong>Specialty:</strong> {selectedMember.specialty}</p>
            <p><strong>Experience:</strong> 10+ years</p>
            <p><strong>Availability:</strong> Mon-Fri, 9AM-5PM</p>
            <button className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded">
              Book Appointment
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default SimpleModalExample;
