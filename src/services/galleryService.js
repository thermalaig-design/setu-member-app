import { supabase } from './supabaseClient';

const TABLE = 'gallery_photos';
const FOLDERS_TABLE = 'gallery_folders';
const BUCKET = 'gallery';
export const UNASSIGNED_FOLDER_ID = 'unassigned';
const GALLERY_CACHE_PREFIX = 'latest_gallery_cache_v1';
const GALLERY_CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes
const FOLDER_COVER_CACHE_PREFIX = 'gallery_folder_cover_cache_v1';
const FOLDER_PHOTOS_CACHE_PREFIX = 'gallery_folder_photos_cache_v1';
const ENABLE_GALLERY_DEBUG_LOGS = import.meta.env.DEV && import.meta.env.VITE_GALLERY_DEBUG === 'true';

// ─── localStorage caching for persistent gallery data ──────────────────────
const PERSISTENT_CACHE_KEY = 'gallery_persistent_cache_v2';
const PERSISTENT_CACHE_TTL = 50 * 60 * 1000; // 50 minutes

export const getPersistentGalleryCache = (trustId = null) => {
  try {
    const raw = localStorage.getItem(PERSISTENT_CACHE_KEY);
    if (!raw) return null;
    
    const parsed = JSON.parse(raw);
    if (!parsed?.cache) return null;
    
    // Check if cache is for the same trust
    if (parsed.trustId !== trustId) {
      console.log('💾 Gallery cache trust mismatch, invalidating');
      return null;
    }
    
    // Check if cache is still valid
    const age = Date.now() - parsed.timestamp;
    if (age > PERSISTENT_CACHE_TTL) {
      console.log('⏰ Gallery cache expired (50 min TTL), clearing');
      localStorage.removeItem(PERSISTENT_CACHE_KEY);
      return null;
    }
    
    const remainingMins = Math.floor((PERSISTENT_CACHE_TTL - age) / 60000);
    console.log(`✅ Gallery cache HIT (expires in ${remainingMins} mins)`);
    return parsed.cache;
  } catch (e) {
    console.warn('Error reading persistent gallery cache:', e);
    return null;
  }
};

export const setPersistentGalleryCache = (trustId = null, data = {}) => {
  try {
    localStorage.setItem(
      PERSISTENT_CACHE_KEY,
      JSON.stringify({
        version: 2,
        trustId,
        timestamp: Date.now(),
        cache: data,
      })
    );
    console.log('💾 Gallery cache saved to localStorage');
  } catch (e) {
    console.warn('Error saving persistent gallery cache:', e);
  }
};

export const clearPersistentGalleryCache = () => {
  try {
    localStorage.removeItem(PERSISTENT_CACHE_KEY);
    console.log('🗑️ Gallery cache cleared');
  } catch (e) {
    console.warn('Error clearing gallery cache:', e);
  }
};

// ─── sessionStorage caching for short-term data ────────────────────────────
const resolveLatestGalleryCacheKey = (trustId = null, limit = 6) => {
  const trustKey = trustId ? String(trustId) : 'global';
  return `${GALLERY_CACHE_PREFIX}:${trustKey}:${limit}`;
};

export const getCachedLatestGalleryImages = (trustId = null, limit = 6) => {
  try {
    const raw = sessionStorage.getItem(resolveLatestGalleryCacheKey(trustId, limit));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !Array.isArray(parsed?.data)) return [];
    if (Date.now() - parsed.ts > GALLERY_CACHE_TTL_MS) return [];
    return parsed.data;
  } catch {
    return [];
  }
};

const setCachedLatestGalleryImages = (trustId = null, limit = 6, data = []) => {
  try {
    sessionStorage.setItem(
      resolveLatestGalleryCacheKey(trustId, limit),
      JSON.stringify({ ts: Date.now(), data: Array.isArray(data) ? data : [] })
    );
  } catch {
    // ignore cache failures
  }
};

function getPublicUrl(storagePath) {
  if (!storagePath) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl || null;
}

function buildPublicUrl(storagePath) {
  if (!storagePath) return null;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) return null;
  const base = supabaseUrl.replace(/\/$/, '');
  let path = storagePath.replace(/^\/+/, '');
  if (path.startsWith(`${BUCKET}/`)) {
    path = path.slice(BUCKET.length + 1);
  }
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${base}/storage/v1/object/public/${BUCKET}/${encodedPath}`;
}

function getDisplayName(storagePath) {
  if (!storagePath) return 'Gallery Photo';
  const file = storagePath.split('/').pop() || storagePath;
  const cleaned = file.replace(/^\d+_/, '');
  return cleaned || 'Gallery Photo';
}

function normalizeFolderRelation(folderRelation) {
  if (Array.isArray(folderRelation)) {
    return folderRelation[0] || null;
  }
  return folderRelation || null;
}

function mapRowToImage(row) {
  const folder = normalizeFolderRelation(row.gallery_folders || row.folder || null);
  const folderName = folder?.name || 'General';
  const rawFolderId = row.folder_id || folder?.id || null;
  const resolvedFolderId = rawFolderId || UNASSIGNED_FOLDER_ID;
  const resolvedTrustId = folder?.trust_id || null;
  const isHttpPath = typeof row.storage_path === 'string' && /^https?:\/\//i.test(row.storage_path);
  const resolvedUrl = row.public_url
    || (isHttpPath ? row.storage_path : null)
    || buildPublicUrl(row.storage_path)
    || getPublicUrl(row.storage_path);
  
  if (ENABLE_GALLERY_DEBUG_LOGS) {
    console.log('🖼️ Mapping image:', {
      id: row.id,
      storage_path: row.storage_path,
      public_url: row.public_url,
      resolvedUrl: resolvedUrl,
      folder: folder?.name,
    });
  }
  
  return {
    id: row.id,
    url: resolvedUrl,
    title: getDisplayName(row.storage_path),
    folderId: resolvedFolderId,
    folderName,
    createdAt: row.created_at,
    storagePath: row.storage_path,
    trustId: resolvedTrustId
  };
}

// Upload photo to Supabase Storage and save metadata to database
export async function uploadGalleryPhoto(file, _originalName = null, folderId = null, trustId = null) {
  try {
    if (!file) throw new Error('No file provided');

    const timestamp = Date.now();
    const fileName = `${timestamp}_${file.name}`;
    const storagePath = fileName;

    // Upload file to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Get user info
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    // Save metadata to gallery_photos table
    const { data: insertData, error: insertError } = await supabase
      .from(TABLE)
      .insert([
        {
          storage_path: storagePath,
          public_url: urlData?.publicUrl || null,
          uploaded_by: userId,
          folder_id: folderId
        }
      ])
      .select();

    if (insertError) throw insertError;

    return {
      success: true,
      photo: insertData[0],
      message: 'Photo uploaded successfully'
    };
  } catch (error) {
    console.error('Error uploading photo:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to upload photo'
    };
  }
}

// Fetch all gallery folders from gallery_folders table
export async function fetchGalleryFolders(trustId = null) {
  try {
    console.log('📁 Fetching gallery folders for trust:', trustId);
    let query = supabase
      .from(FOLDERS_TABLE)
      .select('id, name, description, trust_id')
      .order('name', { ascending: true });

    if (trustId) {
      console.log('📁 Applying trust filter:', trustId);
      query = query.eq('trust_id', trustId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Supabase error fetching folders:', error);
      throw new Error(`Failed to fetch folders: ${error.message}`);
    }
    console.log('✅ Fetched', data?.length || 0, 'folders');
    if (data && data.length > 0) {
      console.log('✅ Folders:', data.map(f => ({ id: f.id, name: f.name, trustId: f.trust_id })));
    }
    return data || [];
  } catch (err) {
    console.error('❌ Error fetching folders:', err.message);
    throw err; // Throw error so context can catch it
  }
}

// Fetch images by folder
export async function fetchImagesByFolder(folderId = null, trustId = null) {
  try {
    const joinSelect = trustId
      ? 'id, storage_path, folder_id, created_at, public_url, gallery_folders!inner ( id, name, trust_id )'
      : 'id, storage_path, folder_id, created_at, public_url, gallery_folders ( id, name, trust_id )';
    let query = supabase
      .from(TABLE)
      .select(joinSelect);

    if (folderId) {
      if (folderId === UNASSIGNED_FOLDER_ID) {
        query = query.is('folder_id', null);
      } else {
        query = query.eq('folder_id', folderId);
      }
    }
    if (trustId) {
      query = query.eq('gallery_folders.trust_id', trustId);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map(mapRowToImage).filter((img) => img.url);
  } catch (err) {
    console.error('Error fetching images by folder:', err);
    return [];
  }
}

// Fetch latest gallery images from database
export async function fetchLatestGalleryImages(limit = 6, trustId = null, opts = {}) {
  const preferCache = opts?.preferCache !== false;
  if (preferCache) {
    const cached = getCachedLatestGalleryImages(trustId, limit);
    if (cached.length > 0) return cached;
  }

  const joinSelect = trustId
    ? 'id, storage_path, folder_id, created_at, public_url, gallery_folders!inner ( id, name, trust_id )'
    : 'id, storage_path, folder_id, created_at, public_url, gallery_folders ( id, name, trust_id )';
  let query = supabase
    .from(TABLE)
    .select(joinSelect)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (trustId) {
    query = query.eq('gallery_folders.trust_id', trustId);
  }

  const { data, error } = await query;

  if (error) throw error;

  const mapped = (data || []).map(mapRowToImage).filter((img) => img.url);
  setCachedLatestGalleryImages(trustId, limit, mapped);
  return mapped;
}

// Fetch initial 2 photos per album (for cover/preview)
export async function fetchAlbumCoverPhotos(trustId = null) {
  const joinSelect = trustId
    ? 'id, storage_path, folder_id, created_at, public_url, gallery_folders!inner ( id, name, trust_id )'
    : 'id, storage_path, folder_id, created_at, public_url, gallery_folders ( id, name, trust_id )';
  
  let query = supabase
    .from(TABLE)
    .select(joinSelect)
    .order('created_at', { ascending: false })
    .limit(50); // Limit to avoid timeout — only need cover photos

  if (trustId) {
    query = query.eq('gallery_folders.trust_id', trustId);
  }

  const { data, error } = await query;

  if (error) throw error;

  const allPhotos = (data || []).map(mapRowToImage).filter((img) => img.url);
  
  // Group by folder and get first 2 from each
  const folderMap = {};
  allPhotos.forEach((photo) => {
    if (!folderMap[photo.folderId]) {
      folderMap[photo.folderId] = [];
    }
    if (folderMap[photo.folderId].length < 2) {
      folderMap[photo.folderId].push(photo);
    }
  });

  return allPhotos.slice(0, 2); // Return only first 2 for initial preview
}

// Fetch all gallery images from database using pagination to avoid statement timeouts
const FETCH_PAGE_SIZE = 100; // Smaller page size reduces query load and timeout risk
const MAX_PAGES = 25;        // Hard cap: 200 × 25 = 5,000 images max

export async function fetchAllGalleryImages(trustId = null, opts = {}) {
  const preferCache = opts?.preferCache !== false;
  const cacheKey = trustId ? `${FOLDER_PHOTOS_CACHE_PREFIX}:${trustId}` : `${FOLDER_PHOTOS_CACHE_PREFIX}:global`;
  
  if (preferCache) {
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.ts && Date.now() - parsed.ts < GALLERY_CACHE_TTL_MS) {
          console.log('📸 Using cached images for trust:', trustId);
          return parsed.data || [];
        }
      }
    } catch (e) {
      console.warn('⚠️ Cache read error:', e.message);
    }
  }

  try {
    console.log('📸 Fetching gallery images (paginated) for trust:', trustId);
    // For trust-specific requests, force DB-level filtering with INNER JOIN
    // to avoid scanning the full gallery table and hitting statement timeout.
    const joinSelect = trustId
      ? 'id, storage_path, folder_id, created_at, public_url, gallery_folders!inner ( id, name, trust_id )'
      : 'id, storage_path, folder_id, created_at, public_url, gallery_folders ( id, name, trust_id )';

    let allData = [];
    let page = 0;
    let hasMore = true;

    while (hasMore && page < MAX_PAGES) {
      const from = page * FETCH_PAGE_SIZE;
      const to = from + FETCH_PAGE_SIZE - 1;

      let query = supabase
        .from(TABLE)
        .select(joinSelect)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (trustId) {
        query = query.eq('gallery_folders.trust_id', trustId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Supabase error fetching images (page', page, '):', error);
        throw new Error(`Failed to fetch images: ${error.message}`);
      }

      const pageData = data || [];
      
      // Log raw data
      console.log(`📊 Page ${page + 1} raw data:`, pageData.length, 'rows');
      if (pageData.length > 0) {
        console.log('📊 First row sample:', pageData[0]);
      }
      
      allData = allData.concat(pageData);
      console.log(`✅ Page ${page + 1}: fetched ${pageData.length} images (total: ${allData.length})`);

      // If we got fewer rows than the page size, there are no more pages
      hasMore = pageData.length === FETCH_PAGE_SIZE;
      page++;
    }

    const mapped = allData.map(mapRowToImage).filter((img) => img.url);
    console.log('📸 Final mapped images:', mapped.length);
    console.log('📸 Images with URLs out of', allData.length, 'total rows');
    if (mapped.length > 0) {
      console.log('📸 Sample image show:', { url: mapped[0].url, folderId: mapped[0].folderId });
    } else {
      console.warn('⚠️ NO IMAGES WITH VALID URLs! Check storage_path and public_url in database.');
      console.log('📸 Sample raw row (before filter):', allData[0]);
    }
    
    // Cache the result
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: mapped }));
    } catch (e) {
      console.warn('⚠️ Cache write error:', e.message);
    }
    
    return mapped;
  } catch (err) {
    console.error('❌ Error fetching images:', err.message);
    throw err;
  }
}

// Fetch photos for a specific folder with pagination
export async function fetchPhotosByFolderPaginated(
  folderId = null,
  trustId = null,
  page = 1,
  perPage = 10,
  opts = {}
) {
  const includeCount = opts?.includeCount !== false;
  const countMode = opts?.countMode || 'exact';
  const disableTrustFallback = opts?.disableTrustFallback === true;
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  const runQuery = async (useTrustFilter = true) => {
    const joinSelect = (trustId && useTrustFilter)
      ? 'id, storage_path, folder_id, created_at, public_url, gallery_folders!inner ( id, name, trust_id )'
      : 'id, storage_path, folder_id, created_at, public_url, gallery_folders ( id, name, trust_id )';

    let query = supabase
      .from(TABLE)
      .select(
        joinSelect,
        includeCount ? { count: countMode } : {}
      )
      .order('created_at', { ascending: false });

    if (folderId === UNASSIGNED_FOLDER_ID) {
      query = query.is('folder_id', null);
    } else if (folderId) {
      query = query.eq('folder_id', folderId);
    }

    if (trustId && useTrustFilter) {
      query = query.eq('gallery_folders.trust_id', trustId);
    }

    query = query.range(from, to);
    return query;
  };

  let { data, error, count } = await runQuery(true);
  if (error) throw error;

  // Fallback: some rows can have folder relation mismatch, causing trust join to return 0.
  // Retry without trust join/filter so folder covers and counts still load.
  if (trustId && folderId && !disableTrustFallback && (count || 0) === 0) {
    console.warn('⚠️ Trust-filtered folder query returned 0, retrying without trust filter for folder:', folderId);
    const fallback = await runQuery(false);
    data = fallback.data;
    count = fallback.count;
    error = fallback.error;
    if (error) throw error;
  }

  const photos = (data || []).map(mapRowToImage).filter((img) => img.url);
  const resolvedCount = includeCount ? (count || 0) : photos.length;
  const totalPages = Math.ceil(resolvedCount / perPage);

  return {
    photos,
    currentPage: page,
    totalPages,
    totalCount: resolvedCount,
    perPage
  };
}

// Fetch gallery folders in paginated batches for infinite-scroll album listing
export async function fetchGalleryFoldersPaginated(trustId = null, page = 1, perPage = 12) {
  try {
    const safePage = Math.max(1, Number(page) || 1);
    const safePerPage = Math.max(1, Number(perPage) || 12);
    const from = (safePage - 1) * safePerPage;
    const to = from + safePerPage - 1;

    let query = supabase
      .from(FOLDERS_TABLE)
      .select('id, name, description, trust_id', { count: 'exact' })
      .order('name', { ascending: true })
      .range(from, to);

    if (trustId) {
      query = query.eq('trust_id', trustId);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const totalCount = Number(count || 0);
    const folders = data || [];
    const hasMore = to + 1 < totalCount;

    return {
      folders,
      page: safePage,
      perPage: safePerPage,
      totalCount,
      hasMore,
    };
  } catch (err) {
    console.error('Error fetching paginated folders:', err);
    throw err;
  }
}

// ─── Cache Management Utilities ────────────────────────────────────────────

export const getCacheStats = () => {
  try {
    const cache = localStorage.getItem(PERSISTENT_CACHE_KEY);
    if (!cache) {
      return { exists: false, age: null, remaining: null, trustId: null };
    }
    
    const parsed = JSON.parse(cache);
    const age = Date.now() - parsed.timestamp;
    const remaining = Math.max(0, PERSISTENT_CACHE_TTL - age);
    
    return {
      exists: true,
      age: Math.floor(age / 1000), // in seconds
      remaining: Math.floor(remaining / 1000), // in seconds
      trustId: parsed.trustId,
      percentValid: Math.floor((remaining / PERSISTENT_CACHE_TTL) * 100)
    };
  } catch (e) {
    return { exists: false, age: null, remaining: null, trustId: null };
  }
};

export const isCacheValid = (trustId = null) => {
  const stats = getCacheStats();
  return stats.exists && stats.trustId === trustId && stats.remaining > 0;
};

export const getCacheSizeEstimate = () => {
  try {
    const cache = localStorage.getItem(PERSISTENT_CACHE_KEY);
    if (!cache) return 0;
    // Rough estimate: each char is ~1 byte in UTF-16
    return Math.ceil(cache.length * 2 / 1024); // Return in KB
  } catch {
    return 0;
  }
};

export const logCacheDebugInfo = (trustId = null) => {
  const stats = getCacheStats();
  const size = getCacheSizeEstimate();
  
  console.group('📊 Gallery Cache Debug Info');
  console.log('Cache Exists:', stats.exists);
  console.log('Trust ID:', stats.trustId);
  console.log('Cache Age:', stats.age ? `${stats.age}s` : 'N/A');
  console.log('Time Remaining:', stats.remaining ? `${stats.remaining}s (~${Math.floor(stats.remaining / 60)} mins)` : 'Expired');
  console.log('Validity %:', `${stats.percentValid}%`);
  console.log('Estimated Size:', `${size}KB`);
  console.log('Is Valid for Trust:', isCacheValid(trustId));
  console.groupEnd();
};


