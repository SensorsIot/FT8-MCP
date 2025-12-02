/**
 * CQ Targeting Logic (v7 FSD §14)
 *
 * Server-side CQ targeting evaluation. Clients MUST NOT reimplement this logic.
 */

import { StationProfile } from '../state/types';

/**
 * Region keywords recognized in CQ messages
 */
const REGION_KEYWORDS = new Set([
    'DX', 'NA', 'SA', 'EU', 'AS', 'AF', 'OC', 'JA',
    // Extended keywords (optional)
    'ASIA', 'EUROPE', 'AFRICA'
]);

/**
 * Extract CQ target token from raw WSJT-X message text (v7 FSD §14)
 *
 * Examples:
 *   "CQ HB9XYZ JN36"     → null
 *   "CQ DX HB9XYZ JN36"  → "DX"
 *   "CQ NA W1ABC FN31"   → "NA"
 *   "CQ EU DL1ABC JO62"  → "EU"
 *   "CQ JA JA1XYZ PM95"  → "JA"
 *
 * @param raw_text Raw decoded message text
 * @returns CQ target token (uppercase) or null
 */
export function extractCqTargetToken(raw_text: string): string | null {
    // Normalize: trim and uppercase
    const text = raw_text.trim().toUpperCase();

    // Must start with "CQ "
    if (!text.startsWith('CQ ')) {
        return null;
    }

    // Split on whitespace
    const tokens = text.split(/\s+/);
    if (tokens.length < 2) {
        return null;
    }

    // Token after "CQ"
    const t1 = tokens[1];

    // If it's a recognized region keyword, return it
    if (REGION_KEYWORDS.has(t1)) {
        return t1;
    }

    // Otherwise, treat tokens[1] as callsign → no explicit CQ target
    return null;
}

/**
 * Determine if this station is allowed to answer a given CQ (v7 FSD §14)
 *
 * This encapsulates all rules for converting CQ target token + station location
 * into the is_directed_cq_to_me boolean.
 *
 * @param stationProfile Station configuration (continent, dxcc, prefixes)
 * @param cq_target_token CQ target token from extractCqTargetToken()
 * @returns true if station is allowed to answer this CQ
 */
export function isDirectedCqToMe(
    stationProfile: StationProfile,
    cq_target_token: string | null
): boolean {
    // No explicit target token → general CQ → always allowed
    if (cq_target_token === null) {
        return true;
    }

    const continent = stationProfile.my_continent.toUpperCase();
    const dxcc = stationProfile.my_dxcc.toUpperCase();

    switch (cq_target_token) {
        case 'DX':
            // "CQ DX" means "stations that are DX to me"
            // For most operators, this is acceptable to treat as "everyone eligible"
            // A stricter implementation would require caller's DXCC and check if different
            // For now: minimal safe default = allow all
            return true;

        case 'NA':
            return continent === 'NA';

        case 'SA':
            return continent === 'SA';

        case 'EU':
        case 'EUROPE':
            return continent === 'EU';

        case 'AS':
        case 'ASIA':
            return continent === 'AS';

        case 'AF':
        case 'AFRICA':
            return continent === 'AF';

        case 'OC':
            return continent === 'OC';

        case 'JA':
            // JA-specific: require DXCC/prefix to be JA, JR, 7J, etc.
            return dxcc.startsWith('JA') ||
                   dxcc.startsWith('JR') ||
                   dxcc.startsWith('7J');

        default:
            // Unknown or unsupported CQ target token
            // Conservative approach: do NOT answer
            return false;
    }
}

/**
 * Enrich a raw decode with CQ targeting fields (v7 FSD §14)
 *
 * This is the integration point for CQ targeting logic.
 * Call this function when constructing InternalDecodeRecord.
 *
 * @param raw_text Raw WSJT-X message text
 * @param is_cq Whether this is a CQ-type message
 * @param stationProfile Station configuration
 * @returns Object with cq_target_token and is_directed_cq_to_me
 */
export function enrichWithCqTargeting(
    raw_text: string,
    is_cq: boolean,
    stationProfile: StationProfile
): { cq_target_token: string | null; is_directed_cq_to_me: boolean } {
    // If not a CQ message, both fields are null/false
    if (!is_cq) {
        return {
            cq_target_token: null,
            is_directed_cq_to_me: false
        };
    }

    // Extract CQ target token
    const cq_target_token = extractCqTargetToken(raw_text);

    // Determine if we're allowed to answer
    const is_directed_cq_to_me = isDirectedCqToMe(stationProfile, cq_target_token);

    return { cq_target_token, is_directed_cq_to_me };
}
