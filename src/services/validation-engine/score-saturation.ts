import type {
  SaturationLabel,
  ValidationSaturationModule,
} from '../../types/validation-engine.types';
import { moduleFromScore } from './bands';
import { SATURATION_THRESHOLDS } from './validation-engine.constants';

export interface SaturationCreativeInput {
  isAd?: boolean | null;
  estimatedVideoGmv?: number | null;
  metrics?: {
    viewCount?: number | null;
    likeCount?: number | null;
    commentCount?: number | null;
    shareCount?: number | null;
  } | null;
  ingestedAt?: Date | string | null;
}

export interface SaturationProductInput {
  creativeCounts?: {
    ads?: number | null;
    organic?: number | null;
    reviews?: number | null;
    total?: number | null;
  } | null;
  relatedVideosCount?: number | null;
}

function labelScore(label: SaturationLabel): number {
  switch (label) {
    case 'early_opportunity':
      return 82;
    case 'validated_opportunity':
      return 78;
    case 'competitive':
      return 52;
    case 'low_proof':
      return 38;
    case 'crowded_late':
      return 28;
    default:
      return 0;
  }
}

function labelText(label: SaturationLabel): string {
  switch (label) {
    case 'low_proof':
      return 'Low creative proof';
    case 'early_opportunity':
      return 'Early opportunity';
    case 'validated_opportunity':
      return 'Validated opportunity';
    case 'competitive':
      return 'Competitive';
    case 'crowded_late':
      return 'Crowded / late';
    default:
      return 'Unknown saturation';
  }
}

export function scoreSaturation(
  product: SaturationProductInput,
  creatives: SaturationCreativeInput[],
): ValidationSaturationModule & {
  creativeCount: number;
  adCreativeCount: number;
  topCreativeGmvShare: number | null;
  heavyAdPressure: boolean;
  oneVideoDependency: boolean;
  crowded: boolean;
} {
  const inputsUsed: string[] = [];
  const missingInputs: string[] = [];
  const caveats: string[] = [];

  const counts = product.creativeCounts;
  const countedTotal =
    counts && typeof counts.total === 'number' ? Math.max(0, counts.total) : null;
  const countedAds = counts && typeof counts.ads === 'number' ? Math.max(0, counts.ads) : null;

  if (counts) inputsUsed.push('creativeCounts');
  else missingInputs.push('creativeCounts');

  const fromCreatives = creatives.length;
  const adFromCreatives = creatives.filter((c) => c.isAd === true).length;

  const creativeCount = Math.max(countedTotal ?? 0, fromCreatives, product.relatedVideosCount ?? 0);
  const adCreativeCount = Math.max(countedAds ?? 0, adFromCreatives);

  if (creatives.length > 0) {
    inputsUsed.push('creatives.metrics.viewCount');
    const hasGmv = creatives.some(
      (c) => c.estimatedVideoGmv != null && Number(c.estimatedVideoGmv) > 0,
    );
    if (hasGmv) inputsUsed.push('estimatedVideoGmv');
    else missingInputs.push('estimatedVideoGmv');
    if (creatives.some((c) => c.isAd === true)) inputsUsed.push('isAd');
  } else {
    missingInputs.push('creatives');
  }

  // Creator independence is not reliable enough for V1.
  missingInputs.push('reliableCreatorIdentity');
  caveats.push('Creator independence is not reliable enough for V1 scoring.');

  let topCreativeGmvShare: number | null = null;
  const gmvValues = creatives
    .map((c) => Number(c.estimatedVideoGmv))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (gmvValues.length > 0) {
    const sum = gmvValues.reduce((a, b) => a + b, 0);
    const top = Math.max(...gmvValues);
    topCreativeGmvShare = sum > 0 ? top / sum : null;
  }

  if (creativeCount <= 0 && !counts) {
    return {
      ...moduleFromScore(
        'saturation',
        null,
        'Insufficient creative data to score market saturation.',
        inputsUsed,
        [...new Set(missingInputs)],
        caveats,
      ),
      saturationLabel: 'unknown',
      creativeCount: 0,
      adCreativeCount: 0,
      topCreativeGmvShare,
      heavyAdPressure: false,
      oneVideoDependency: false,
      crowded: false,
    };
  }

  const adShare = creativeCount > 0 ? adCreativeCount / creativeCount : 0;
  const heavyAdPressure = adShare >= SATURATION_THRESHOLDS.heavyAdShare && adCreativeCount >= 3;
  const oneVideoDependency =
    topCreativeGmvShare != null && topCreativeGmvShare >= SATURATION_THRESHOLDS.oneVideoShare;

  let saturationLabel: SaturationLabel;
  if (creativeCount <= SATURATION_THRESHOLDS.lowProofMax) {
    saturationLabel = 'low_proof';
  } else if (
    creativeCount > SATURATION_THRESHOLDS.competitiveMax ||
    oneVideoDependency ||
    (heavyAdPressure && creativeCount > SATURATION_THRESHOLDS.validatedMax)
  ) {
    saturationLabel = 'crowded_late';
  } else if (
    creativeCount > SATURATION_THRESHOLDS.validatedMax ||
    heavyAdPressure ||
    adCreativeCount >= 8
  ) {
    saturationLabel = 'competitive';
  } else if (creativeCount <= SATURATION_THRESHOLDS.earlyMax) {
    saturationLabel = 'early_opportunity';
  } else {
    saturationLabel = 'validated_opportunity';
  }

  const crowded = saturationLabel === 'crowded_late' || saturationLabel === 'competitive';

  let score = labelScore(saturationLabel);
  if (oneVideoDependency) {
    score = Math.min(score, 35);
    caveats.push('Estimated video GMV is concentrated in a single creative.');
  }
  if (heavyAdPressure) {
    score = Math.min(score, saturationLabel === 'crowded_late' ? score : 48);
    caveats.push('Ad pressure is elevated relative to total creative count.');
  }

  const reason =
    saturationLabel === 'validated_opportunity'
      ? 'Product has enough creative proof to validate interest without obvious crowding signals.'
      : saturationLabel === 'early_opportunity'
        ? 'Creative proof is emerging without clear crowding.'
        : saturationLabel === 'low_proof'
          ? 'Too little creative evidence to validate demand distribution.'
          : saturationLabel === 'competitive'
            ? 'Creative volume or ad pressure suggests a competitive market.'
            : saturationLabel === 'crowded_late'
              ? 'Creative/ad pressure or concentration risk suggests a crowded late market.'
              : 'Saturation could not be determined from available creative data.';

  const mod = moduleFromScore(
    'saturation',
    score,
    reason,
    [...new Set(inputsUsed)],
    [...new Set(missingInputs)],
    caveats,
  );

  return {
    ...mod,
    label: labelText(saturationLabel),
    saturationLabel,
    creativeCount,
    adCreativeCount,
    topCreativeGmvShare,
    heavyAdPressure,
    oneVideoDependency,
    crowded,
  };
}
