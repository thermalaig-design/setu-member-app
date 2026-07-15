import * as memberService from '../services/memberService.js';

const resolveTrustId = async (trustId, trustName) => {
  if (trustId) return trustId;
  if (!trustName) return null;
  try {
    return await memberService.getTrustIdByName(trustName);
  } catch (error) {
    console.error('Error resolving trust id:', error);
    return null;
  }
};

/**
 * Get members by type
 */
export const getMembersByType = async (req, res, next) => {
  try {
    const { type } = req.params;
    const { trust_id: trustId, trust_name: trustName } = req.query;
    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    const members = await memberService.getMembersByType(type, resolvedTrustId || null);
    
    res.status(200).json({
      success: true,
      count: members.length,
      data: members
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Search members
 */
export const searchMembers = async (req, res, next) => {
  try {
    const { query, type, trust_id: trustId, trust_name: trustName } = req.query;
    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    const members = await memberService.searchMembers(query, type, resolvedTrustId || null);
    
    res.status(200).json({
      success: true,
      count: members.length,
      data: members
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get member by ID
 */
export const getMemberById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const member = await memberService.getMemberById(id);
    
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: member
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all member types
 */
export const getMemberTypes = async (req, res, next) => {
  try {
    const { trust_id: trustId, trust_name: trustName } = req.query;
    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    const types = await memberService.getMemberTypes(resolvedTrustId || null);
    
    res.status(200).json({
      success: true,
      count: types.length,
      data: types
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all members
 */
export const getAllMembers = async (req, res, next) => {
  try {
    const { page, limit, trust_id: trustId, trust_name: trustName } = req.query;
    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    // If pagination params are provided, return a paginated subset
    if (page || limit) {
      const pageNum = Number(page) || 1;
      const pageSize = Number(limit) || 100;
      console.log(`API: Getting members page ${pageNum} size ${pageSize}`);
      const result = await memberService.getMembersPage(pageNum, pageSize, resolvedTrustId || null);
      return res.status(200).json({
        success: true,
        count: result.count,
        data: result.data
      });
    }

    console.log('API: Getting all members...');
    const members = await memberService.getAllMembers(resolvedTrustId || null);
    console.log(`API: Returning ${members.length} members`);

    res.status(200).json({
      success: true,
      count: members.length,
      data: members
    });
  } catch (error) {
    console.error('API Error in getAllMembers:', error);
    next(error);
  }
}

/**
 * Get all doctors from opd_schedule
 */
export const getAllDoctors = async (req, res, next) => {
  try {
    const { trust_id: trustId, trust_name: trustName } = req.query;
    const doctors = await memberService.getAllDoctors(trustId || null, trustName || null);
    
    res.status(200).json({
      success: true,
      count: doctors.length,
      data: doctors
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a preview/sample of members
 */
export const getMembersPreview = async (req, res, next) => {
  try {
    const { limit, trust_id: trustId, trust_name: trustName } = req.query;
    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    const members = await memberService.getMembersPreview(limit || 100, resolvedTrustId || null);

    res.status(200).json({
      success: true,
      count: members.length,
      data: members
    });
  } catch (error) {
    console.error('API Error in getMembersPreview:', error);
    next(error);
  }
};

/**
 * Get all committee members
 */
export const getAllCommitteeMembers = async (req, res, next) => {
  try {
    const { trust_id: trustId, trust_name: trustName } = req.query;
    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    const committee = await memberService.getAllCommitteeMembers(resolvedTrustId || null);
    
    res.status(200).json({
      success: true,
      count: committee.length,
      data: committee
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all hospitals
 */
export const getAllHospitals = async (req, res, next) => {
  try {
    const { trust_id: trustId, trust_name: trustName } = req.query;
    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    const hospitals = await memberService.getAllHospitals(resolvedTrustId || null, trustName || null);
    
    res.status(200).json({
      success: true,
      count: hospitals.length,
      data: hospitals
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all elected members
 */
export const getAllElectedMembers = async (req, res, next) => {
  try {
    const { trust_id: trustId, trust_name: trustName } = req.query;
    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    const electedMembers = await memberService.getAllElectedMembers(resolvedTrustId || null);
    
    res.status(200).json({
      success: true,
      count: electedMembers.length,
      data: electedMembers
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Debug endpoint for elected members
 */
export const getElectedMembersDebug = async (req, res, next) => {
  try {
    const { trust_id: trustId, trust_name: trustName } = req.query;
    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    
    console.log('🔍 DEBUG: getElectedMembersDebug');
    console.log('  trust_id:', trustId);
    console.log('  trust_name:', trustName);
    console.log('  resolvedTrustId:', resolvedTrustId);
    
    const electedMembers = await memberService.getAllElectedMembers(resolvedTrustId || null);
    
    const debugInfo = {
      success: true,
      debug: {
        trustId,
        trustName,
        resolvedTrustId,
        fetchedCount: electedMembers.length,
        sampleData: electedMembers.slice(0, 3),
        fieldsPresent: electedMembers.length > 0 ? Object.keys(electedMembers[0]) : [],
      },
      count: electedMembers.length,
      data: electedMembers.slice(0, 10) // Return only first 10 for debug
    };
    
    console.log('✅ DEBUG Response:', JSON.stringify(debugInfo.debug, null, 2));
    
    res.status(200).json(debugInfo);
  } catch (error) {
    console.error('❌ ERROR in getElectedMembersDebug:', error.message);
    next(error);
  }
};

/**
 * Get member trust links for a specific member
 */
export const getMemberTrustLinks = async (req, res, next) => {
  try {
    const { member_id: memberId } = req.params;
    
    if (!memberId) {
      return res.status(400).json({
        success: false,
        message: 'member_id is required'
      });
    }

    const links = await memberService.getMemberTrustLinks(memberId);
    
    res.status(200).json({
      success: true,
      count: links.length,
      data: links
    });
  } catch (error) {
    console.error('Error fetching member trust links:', error);
    next(error);
  }
};
