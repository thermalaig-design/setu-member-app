import { supabase } from './config/supabase.js';

const AVAILABLE_HOME_SECTIONS = ['trustList', 'marquee', 'gallery', 'quickActions', 'sponsors'];
const AVAILABLE_THEME_ANIMATIONS = ['none', 'fadeUp', 'fadeSlideDown', 'zoomIn', 'fadeIn'];
const LEGACY_THEME_ANIMATION_ALIASES = {
  slideUp: 'fadeUp'
};

const parseArgs = () => {
  const rawArgs = process.argv.slice(2);
  return {
    json: rawArgs.includes('--json'),
    failOnWarnings: rawArgs.includes('--fail-on-warnings')
  };
};

const safeParseJson = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const sanitizeCustomCss = (css) => {
  const text = typeof css === 'string' ? css : '';
  if (!text.trim()) return '';
  const blockedPatterns = [
    /@import/gi,
    /javascript:/gi,
    /expression\s*\(/gi,
    /<\/?script/gi,
    /behavior\s*:/gi
  ];
  const isBlocked = blockedPatterns.some((pattern) => pattern.test(text));
  return isBlocked ? '' : text;
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
};

const findInvalidHomeLayoutEntries = (value) =>
  normalizeStringArray(value).filter((entry) => !AVAILABLE_HOME_SECTIONS.includes(entry));

const findDuplicateEntries = (value) => {
  const items = normalizeStringArray(value);
  const seen = new Set();
  const duplicates = [];

  items.forEach((entry) => {
    if (seen.has(entry) && !duplicates.includes(entry)) {
      duplicates.push(entry);
      return;
    }
    seen.add(entry);
  });

  return duplicates;
};

const findInvalidAnimationEntries = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

  return Object.entries(value)
    .map(([slot, animation]) => ({
      slot,
      animation: String(animation || '').trim()
    }))
    .filter(({ animation }) => {
      if (!animation) return false;
      const normalized = LEGACY_THEME_ANIMATION_ALIASES[animation] || animation;
      return !AVAILABLE_THEME_ANIMATIONS.includes(normalized);
    });
};

const printHeading = (text) => {
  console.log(`\n${text}`);
  console.log('='.repeat(text.length));
};

const printList = (title, items) => {
  console.log(`\n${title}: ${items.length}`);
  if (!items.length) {
    console.log('  None');
    return;
  }

  items.forEach((item) => {
    console.log(`  - ${item}`);
  });
};

const main = async () => {
  const options = parseArgs();

  const [{ data: trusts, error: trustsError }, { data: templates, error: templatesError }] = await Promise.all([
    supabase
      .from('Trust')
      .select('id, name, template_id, created_at'),
    supabase
      .from('app_templates')
      .select('id, trust_id, name, template_key, theme_config, home_layout, animations, custom_css, updated_at')
  ]);

  if (trustsError) {
    throw new Error(`Failed to fetch Trust records: ${trustsError.message}`);
  }

  if (templatesError) {
    throw new Error(`Failed to fetch app_templates records: ${templatesError.message}`);
  }

  const trustList = Array.isArray(trusts) ? trusts : [];
  const templateList = Array.isArray(templates) ? templates : [];
  const templatesById = new Map(templateList.map((template) => [String(template.id), template]));
  const linksByTemplateId = new Map();

  trustList.forEach((trust) => {
    const templateId = String(trust.template_id || '').trim();
    if (!templateId) return;
    const current = linksByTemplateId.get(templateId) || [];
    current.push(trust);
    linksByTemplateId.set(templateId, current);
  });

  const blockingIssues = [];
  const warnings = [];
  const informational = [];

  trustList.forEach((trust) => {
    const trustId = String(trust.id || '').trim();
    const trustName = String(trust.name || '').trim() || trustId;
    const templateId = String(trust.template_id || '').trim();

    if (!templateId) {
      blockingIssues.push(`[Missing Template Link] ${trustName} (${trustId}) has no template_id`);
      return;
    }

    const template = templatesById.get(templateId);
    if (!template) {
      blockingIssues.push(`[Broken Template Link] ${trustName} (${trustId}) points to missing template ${templateId}`);
      return;
    }

    if (String(template.trust_id || '').trim() && String(template.trust_id) !== trustId) {
      informational.push(
        `[Shared Template Link] ${trustName} (${trustId}) uses template "${template.name || templateId}" owned by trust ${template.trust_id}`
      );
    }
  });

  templateList.forEach((template) => {
    const templateId = String(template.id || '').trim();
    const templateName = String(template.name || '').trim() || templateId;
    const linkedTrusts = linksByTemplateId.get(templateId) || [];
    const parsedThemeConfig = safeParseJson(template.theme_config);
    const invalidHomeLayoutEntries = findInvalidHomeLayoutEntries(template.home_layout);
    const duplicateHomeLayoutEntries = findDuplicateEntries(template.home_layout);
    const invalidAnimationEntries = findInvalidAnimationEntries(template.animations);
    const safeCustomCss = sanitizeCustomCss(template.custom_css || '');

    if (!linkedTrusts.length) {
      warnings.push(`[Unused Template] "${templateName}" (${templateId}) is not linked from any Trust.template_id`);
    }

    if (linkedTrusts.length > 1) {
      informational.push(
        `[Multi-Trust Template] "${templateName}" (${templateId}) is linked by ${linkedTrusts.length} trusts: ${linkedTrusts.map((trust) => trust.name || trust.id).join(', ')}`
      );
    }

    if (!parsedThemeConfig || typeof parsedThemeConfig !== 'object' || Array.isArray(parsedThemeConfig)) {
      blockingIssues.push(`[Invalid Theme Config] "${templateName}" (${templateId}) has malformed theme_config`);
    }

    if (invalidHomeLayoutEntries.length > 0) {
      warnings.push(
        `[Invalid Home Layout] "${templateName}" (${templateId}) has unsupported sections: ${invalidHomeLayoutEntries.join(', ')}`
      );
    }

    if (duplicateHomeLayoutEntries.length > 0) {
      warnings.push(
        `[Duplicate Home Layout] "${templateName}" (${templateId}) repeats sections: ${duplicateHomeLayoutEntries.join(', ')}`
      );
    }

    if (invalidAnimationEntries.length > 0) {
      warnings.push(
        `[Invalid Animations] "${templateName}" (${templateId}) has unsupported animation values: ${invalidAnimationEntries.map(({ slot, animation }) => `${slot}=${animation}`).join(', ')}`
      );
    }

    if (String(template.custom_css || '').trim() && !safeCustomCss) {
      warnings.push(`[Blocked Custom CSS] "${templateName}" (${templateId}) contains unsafe CSS and will be ignored`);
    }
  });

  const summary = {
    totalTrusts: trustList.length,
    totalTemplates: templateList.length,
    blockingIssues: blockingIssues.length,
    warnings: warnings.length,
    informational: informational.length,
    generatedAt: new Date().toISOString()
  };

  if (options.json) {
    console.log(JSON.stringify({
      summary,
      blockingIssues,
      warnings,
      informational
    }, null, 2));
  } else {
    printHeading('Theme Rollout Audit');
    console.log(`Trusts: ${summary.totalTrusts}`);
    console.log(`Templates: ${summary.totalTemplates}`);
    console.log(`Blocking issues: ${summary.blockingIssues}`);
    console.log(`Warnings: ${summary.warnings}`);
    console.log(`Informational: ${summary.informational}`);

    printList('Blocking Issues', blockingIssues);
    printList('Warnings', warnings);
    printList('Informational', informational);
  }

  const shouldFail = blockingIssues.length > 0 || (options.failOnWarnings && warnings.length > 0);
  process.exit(shouldFail ? 1 : 0);
};

main().catch((error) => {
  console.error('\nTheme rollout audit failed');
  console.error(error?.message || error);
  process.exit(1);
});
