import { lookupClientLocation, maskIp } from '../services/geoIpService.js';

/**
 * GET /api/client-location
 * Approximate city/state/country of the requesting client from the local
 * GeoLite2 database. The raw IP is never returned.
 */
export const getClientLocation = async (req, res, next) => {
  try {
    const lookup = await lookupClientLocation(req);

    if (lookup.status === 'unavailable') {
      return res.status(503).json({
        success: false,
        message: 'Location service is temporarily unavailable',
        source: lookup.source
      });
    }

    const body = {
      success: true,
      city: lookup.city,
      state: lookup.state,
      country: lookup.country,
      countryName: lookup.countryName,
      accuracyRadiusKm: lookup.accuracyRadiusKm,
      source: lookup.source
    };

    // Explains an all-null answer (private/local IP, or IP not in the database).
    if (lookup.status !== 'ok') body.reason = lookup.status;

    if (process.env.NODE_ENV === 'development') {
      body.debug = { maskedIp: maskIp(lookup.ip), status: lookup.status };
    }

    return res.status(200).json(body);
  } catch (error) {
    console.error('Error in getClientLocation:', error?.message || error);
    next(error);
  }
};
