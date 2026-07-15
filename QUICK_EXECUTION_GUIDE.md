# Quick Execution Guide - Supabase Updates

## 🚀 Fast Track: Copy & Paste into Supabase

### Step 1: Access Supabase Dashboard
1. Go to https://app.supabase.com
2. Select your "Mahila Mandal" project
3. Click "SQL Editor" in left sidebar

### Step 2: Run This Query

```sql
-- ✅ UPDATE both MAH and MMPB templates with new home_layout
UPDATE "public"."app_templates" 
SET 
  "home_layout" = '["marquee", "trustList", "quickActions", "gallery", "sponsors"]',
  "updated_at" = NOW()
WHERE "template_key" IN ('mah', 'mmpb');

-- Verify the changes
SELECT 
  id,
  name,
  template_key,
  home_layout,
  is_active,
  updated_at
FROM "public"."app_templates"
WHERE template_key IN ('mah', 'mmpb')
ORDER BY created_at DESC;
```

### Step 3: Expected Result
You should see 2 rows updated with:
- `home_layout` = `["marquee", "trustList", "quickActions", "gallery", "sponsors"]`

### Step 4: Verify in Browser
1. Refresh your Mahila Mandal app
2. Go to Home page
3. You should see:
   - ✅ Updates section (Marquee) - shows latest announcements
   - ✅ Associated Trusts section - shows all trusts with switch buttons
   - ✅ Quick Actions - existing quick access tiles
   - ✅ Gallery - existing gallery section
   - ✅ Our Sponsor - existing sponsor section

## 📊 What Was Added

### In Code (Home.jsx):
```javascript
// New Marquee Section
marquee: ff('feature_marquee') && marqueeUpdates.length > 0 ? (
  <div className="px-4 mt-5 mb-4" key="marquee">
    // Shows up to 5 latest marquee updates
  </div>
)

// New Trust List Section  
trustList: trustList && trustList.length > 1 ? (
  <div className="px-4 mt-5 mb-4" key="trustList">
    // Shows all user's associated trusts in a table
  </div>
)
```

### In Database (app_templates):
```json
home_layout: ["marquee", "trustList", "quickActions", "gallery", "sponsors"]
```

## ⚙️ Customization

### Change Order of Sections
In Supabase, update home_layout to any order you want:
```json
["quickActions", "marquee", "gallery", "trustList", "sponsors"]
```

### Remove a Section
Delete the key from array:
```json
["marquee", "trustList", "quickActions", "sponsors"]  // No gallery
```

### Add More Sections
Add keys to array (must be defined in SECTIONS object in Home.jsx)

## 🔄 Rollback (if needed)

To revert to old layout:
```sql
UPDATE "public"."app_templates" 
SET 
  "home_layout" = '["quickActions", "gallery", "sponsors"]',
  "updated_at" = NOW()
WHERE "template_key" IN ('mah', 'mmpb');
```

## ❓ Troubleshooting

### Marquee Section Not Showing?
- Check if `feature_marquee` is enabled in feature_flags
- Check if there are marquee updates in the database
- Run: `SELECT * FROM notifications WHERE type = 'marquee' LIMIT 5;`

### Trust List Section Not Showing?
- Check if user has more than 1 trust
- Check if user is logged in with hospital_memberships
- Currently only shows for users with 2+ trusts

### Styling Issues?
- Clear browser cache: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
- Check if theme colors are set correctly in app_templates
- Check if custom_css has any conflicting styles

## 📞 Files & Commands Reference

**Frontend Code:** 
- [src/Home.jsx](../../src/Home.jsx) - All new sections coded here

**SQL Files:**
- `supabase_templates_update.sql` - For UPDATE (recommended for existing data)
- `supabase_insert_templates_with_marquee.sql` - For INSERT/UPSERT

**Documentation:**
- `MARQUEE_TRUSTLIST_IMPLEMENTATION.md` - Full implementation details

---

**That's it! Your app is ready to use. 🎉**
