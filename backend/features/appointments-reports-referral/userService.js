import crypto from 'crypto';

/**
 * Generate a deterministic UUID from user identifier (phone/membership number)
 * This ensures the same user always gets the same UUID
 * Format: UUID v4-like but deterministic
 */
export const getUserUUID = async (phoneNumber, membershipNumber) => {
  try {
    // Use membership number if available, otherwise phone number
    const identifier = membershipNumber || phoneNumber || 'default';
    
    // Create deterministic UUID from identifier
    // Using namespace UUID for deterministic generation
    const namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace
    const input = `${namespace}-${identifier}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    
    // Convert to UUID format (8-4-4-4-12)
    // Set version (4) and variant bits
    const uuidString = [
      hash.substring(0, 8),
      hash.substring(8, 12),
      '4' + hash.substring(13, 16), // Version 4
      ((parseInt(hash.substring(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.substring(17, 20), // Variant
      hash.substring(20, 32)
    ].join('-');

    return uuidString;
  } catch (error) {
    console.error('Error generating user UUID:', error);
    // Fallback: return null and let the backend handle it
    return null;
  }
};

