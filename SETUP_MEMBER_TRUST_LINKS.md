# Member Trust Links Feature - Setup Guide

## 📋 Overview
This feature allows members with multiple trust associations to view all their memberships in one place through the sidebar.

## 🗄️ Database Setup

### 1. Run the SQL in Supabase SQL Editor
Execute the SQL from: `backend/sql/member_trust_links.sql`

This creates:
- `member_trust_links` table
- Unique constraint on (member_id, trust_id)
- Indexes for performance

### 2. Add Test Data (Optional)
```sql
INSERT INTO member_trust_links (
  member_id, trust_id, membership_no, location, is_active
) VALUES (
  'member-uuid-here', 'trust-uuid-here', 'MEM-001', 'Delhi', true
);
```

## 🔌 API Endpoints

### Get Member Trust Links
```
GET /member/:member_id/trust-links
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "uuid",
      "member_id": "uuid",
      "trust_id": "uuid",
      "membership_no": "MM-001",
      "location": "Delhi",
      "remark1": "Active member",
      "remark2": null,
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "Trust": {
        "id": "uuid",
        "name": "Mahila Mandal",
        "icon_url": "https://..."
      }
    }
  ]
}
```

## 🎨 UI Location
- **Location:** Sidebar (left panel)
- **Section:** Under main menu items
- **Label:** "Other Membership Details"
- **Type:** Expandable accordion
- **Shows when:** Member has 1+ trust links

## 💾 Data Storage

### localStorage Keys
- `memberTrustLinks_{memberId}` - Cached trust links data

### API Call Flow
1. Check localStorage cache first (instant)
2. If not cached, fetch from API
3. Cache results for future sidebar opens
4. Data updates on each login

## 🚀 Frontend Usage

### In Components
```javascript
import { getMemberTrustLinks } from '../services/api';

// Fetch member trust links
const response = await getMemberTrustLinks(memberId);

// Access data
const links = response.data; // Array of trust links
```

## ✅ Verification Checklist

- [ ] SQL table created in Supabase
- [ ] Backend service function added (memberService.js)
- [ ] Controller method added (memberController.js)
- [ ] Route added (memberRoutes.js)
- [ ] Frontend service function added (api.js)
- [ ] Sidebar component updated
- [ ] Test with a member having multiple trusts
- [ ] Verify localStorage caching works
- [ ] Check responsive design on mobile

## 🐛 Troubleshooting

### Memberships not showing
- Check if `members_id` is in localStorage after login
- Verify member actually has trust links in database
- Check browser console for API errors

### Slow loading
- Clear localStorage: `localStorage.clear()`
- Check network tab for slow API response
- Verify database connection

### Styling issues
- Ensure Tailwind CSS is loaded
- Check color constants match theme (#2B2F7E, #C0241A)
- Verify icon imports (ChevronDown)

## 📱 Responsive Design
- Desktop: Full width sidebar with proper spacing
- Mobile: Touch-friendly expandable section
- Scrollable list if many memberships

## 🔐 Security Notes
- Data cached in localStorage (client-side)
- Backend validates member_id parameter
- Foreign key constraints prevent orphaned records
- RLS (Row Level Security) recommended in Supabase

## 📝 Future Enhancements
- Add sorting options (by date, trust name)
- Add search/filter within memberships
- Show membership status (active/inactive)
- Add edit membership details modal
- Export membership list as PDF/CSV
