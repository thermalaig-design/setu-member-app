import React from 'react';

const AdminUserProfiles = ({ onNavigate }) => {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Admin User Profiles</h1>
      <p>This is the Admin User Profiles page. Implement user management features here.</p>
      <button
        onClick={() => onNavigate('home')}
        className="mt-4 px-4 py-2 bg-blue-500 text-white rounded"
      >
        Back to Home
      </button>
    </div>
  );
};

export default AdminUserProfiles;