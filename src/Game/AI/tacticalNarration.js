const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

// Keep this vocabulary deliberately about ground control. A battle can happen
// without a border move, but a sentence saying that a cell, city or bridgehead
// was secured must have a matching territorial operation in the same event.
const CAPTURE_LANGUAGE = /\b(captur\w*|seiz\w*|annex\w*|conquer\w*|occup(?:y|ies|ied|ation)|overr[au]n|liberat\w*|retak\w*|retaken|recaptur\w*|cedes?|ceded|ceding|cession|fell to|falls? to)\b|(?:захва|овлад|аннекс|завоев|оккуп|освобод|отбил|уступ|передал)/iu;
const TACTICAL_CONTROL_LANGUAGE = /\b(secur\w*|hold\w*|held|occup\w*|captur\w*|seiz\w*|advanc\w*|push\w*|assault\w*|cross\w*|widen\w*)\b|(?:закреп|удерж|заня|захва|овлад|продвин|наступ|атак|штурм|форсир|расшир|переш|прорва)/iu;
const TACTICAL_GROUND_LANGUAGE = /\b(cell|bridgehead|front|flank|sector|salient|ground|position|village|district|city|town|road|bridge|river|suburb|port|harbor|beach|objective|border|approach)\b|(?:клетк|плацдарм|фронт|фланг|выступ|сектор|рубеж|позици|местност|деревн|город|посёл|посел|дорог|мост|рек|пригород|порт|гаван|берег|объект|границ|подход|район)/iu;
const NEGATED_GROUND_CHANGE_PATTERNS = [
  /\b(?:no|without|not|never|did\s+not|didn['’]t)\s+(?:(?:confirmed|significant|further)\s+)?(?:ground(?:\s+changed?)?|territorial\s+control|advance|capture|seizure|progress|gain|change(?:d)?(?:\s+hands?)?)\b/iu,
  /(?:\b(?:без|не|нет|не\s+было|не\s+удалось)\b)(?:\s+\p{L}+){0,3}\s+(?:захват\p{L}*|продвиж\p{L}*|измен\p{L}*|контрол\p{L}*|переход\p{L}*)/iu,
  /(?:захват\p{L}*|продвиж\p{L}*|измен\p{L}*|контрол\p{L}*|переход\p{L}*)\s+(?:не|нет|не\s+было|не\s+удалось)/iu,
];

export const claimsTacticalGround = (value) => {
  const narration = normalizeString(value);
  if (NEGATED_GROUND_CHANGE_PATTERNS.some((pattern) => pattern.test(narration))) return false;
  return TACTICAL_GROUND_LANGUAGE.test(narration)
    && (CAPTURE_LANGUAGE.test(narration) || TACTICAL_CONTROL_LANGUAGE.test(narration));
};

// A final model attempt is salvaged instead of being replaced by the canned
// simulation. Keep useful unit/resource/diplomatic impacts, but do not leave a
// newspaper headline claiming a capture that the map cannot show.
export const sanitizeUngroundedTacticalEvents = (candidate) => {
  const sanitized = [];
  for (let index = 0; index < normalizeArray(candidate?.events).length; index += 1) {
    const event = candidate.events[index];
    const impacts = event?.impacts;
    const hasTerritorialImpact = normalizeArray(impacts?.regionTransfers).length > 0
      || normalizeArray(impacts?.sectorOps).length > 0
      || normalizeArray(impacts?.territoryOps).length > 0;
    if (hasTerritorialImpact || !claimsTacticalGround(`${normalizeString(event?.title)} ${normalizeString(event?.description)}`)) {
      continue;
    }

    const narration = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
    const russian = /[А-Яа-яЁё]/u.test(narration);
    event.title = russian ? "Фронт — бой продолжается" : "Front — fighting continues";
    event.description = russian
      ? "Силы обменялись огнём и скорректировали позиции; подтверждённого изменения контроля территории за этот период нет."
      : "Forces exchanged fire and adjusted positions; no confirmed change of territorial control occurred during this period.";
    sanitized.push(index);
  }
  return sanitized;
};
