import { toCountryName } from "../../runtime/ownerNames.js";

export const FIGURE_BRAIN_MODES = Object.freeze(["off", "light", "full"]);
export const FIGURE_MEETING_MODES = Object.freeze(["cabinet", "secure-channel", "correspondence"]);

const normalizeText = (value) => String(value ?? "").trim();
const normalizeMode = (value) => normalizeText(value).toLowerCase();

export const normalizeMeetingMode = (value) => {
  const mode = normalizeMode(value);
  if (mode === "in-person" || mode === "in person" || mode === "office") return "cabinet";
  if (mode === "secure" || mode === "radio" || mode === "encrypted") return "secure-channel";
  return FIGURE_MEETING_MODES.includes(mode) ? mode : "cabinet";
};

export const figureBrainMode = (figure) => {
  const explicit = normalizeMode(figure?.brainMode);
  if (FIGURE_BRAIN_MODES.includes(explicit)) return explicit;
  // Saves from the first implementation used brainEnabled instead of a budgeted
  // mode. Preserve that meaning, but never promote an omitted field to full.
  return figure?.brainEnabled === true ? "full" : "off";
};

export const isFigureBrainActive = (figure) =>
  figureBrainMode(figure) === "full" &&
  normalizeMode(figure?.brainStatus || "active") === "active" &&
  normalizeMode(figure?.status || "active") === "active";

const parseYear = (value) => {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/(^|[^\d])(-?\d{1,4})(?=[^\d]|$)/);
  if (!match) return null;
  const year = Number(match[2]);
  return Number.isFinite(year) ? year : null;
};

const samePolity = (left, right) => {
  const a = toCountryName(normalizeText(left)).toLowerCase();
  const b = toCountryName(normalizeText(right)).toLowerCase();
  return Boolean(a && b && a === b);
};

const hasMeetingMode = (figure, mode) => {
  const modes = Array.isArray(figure?.meetingModes)
    ? figure.meetingModes.map((entry) => normalizeMeetingMode(entry))
    : ["secure-channel", "correspondence"];
  return modes.includes(mode);
};

const explicitInPersonAccess = (figure) =>
  normalizeMode(figure?.meetingAccess) === "granted" && hasMeetingMode(figure, "cabinet");

const dateReason = (figure, gameDate) => {
  const currentYear = parseYear(gameDate);
  if (currentYear === null) return "";
  const birthYear = parseYear(figure?.birthDate || figure?.birth || figure?.dateOfBirth || figure?.birthYear);
  const deathYear = parseYear(figure?.deathDate || figure?.death || figure?.dateOfDeath || figure?.deathYear);
  if (birthYear !== null && currentYear < birthYear) return `${figure.name} has not been born by ${gameDate}.`;
  if (deathYear !== null && currentYear > deathYear) return `${figure.name} is no longer alive by ${gameDate}.`;
  return "";
};

const figureAvailabilityReason = (figure, gameDate) => {
  if (!figure) return "Unknown figure.";
  const temporal = dateReason(figure, gameDate);
  if (temporal) return temporal;
  const status = normalizeMode(figure.status || "active");
  if (["deceased", "retired", "missing"].includes(status)) return `${figure.name} is not available for a direct exchange (${status}).`;
  if (status === "imprisoned" && !hasMeetingMode(figure, "secure-channel") && !hasMeetingMode(figure, "correspondence")) {
    return `${figure.name} has no permitted remote contact channel while imprisoned.`;
  }
  if (normalizeMode(figure.brainStatus) === "paused" || normalizeMode(figure.brainStatus) === "retired") {
    return `${figure.name}'s personal brain is not active.`;
  }
  if (figureBrainMode(figure) !== "full") return `${figure.name} is not running a full personal brain.`;
  return "";
};

export const evaluateFigureMeeting = ({
  figures = [],
  figure,
  playerPolity = "",
  gameDate = "",
  meetingMode = "cabinet",
} = {}) => {
  const participants = (Array.isArray(figures) && figures.length > 0 ? figures : [figure]).filter(Boolean);
  const mode = normalizeMeetingMode(meetingMode);
  if (participants.length === 0) return { allowed: false, mode, reason: "No figure was selected." };

  for (const participant of participants) {
    const reason = figureAvailabilityReason(participant, gameDate);
    if (reason) return { allowed: false, mode, reason, blockedBy: participant.id || participant.name };
    if (normalizeMode(participant.meetingAccess) === "impossible") {
      return { allowed: false, mode, reason: `${participant.name} has no available contact channel.`, blockedBy: participant.id || participant.name };
    }
    if (!hasMeetingMode(participant, mode)) {
      return { allowed: false, mode, reason: `${participant.name} cannot be reached through ${mode}.`, blockedBy: participant.id || participant.name };
    }
  }

  if (mode === "cabinet") {
    for (const participant of participants) {
      if (!samePolity(participant.polity || participant.ownerCode, playerPolity)) {
        if (!explicitInPersonAccess(participant)) {
          return {
            allowed: false,
            mode,
            reason: `A physical cabinet cannot include ${participant.name} from another polity without an explicit access grant. Use a secure channel or correspondence.`,
            blockedBy: participant.id || participant.name,
          };
        }
      }
    }
    for (let leftIndex = 0; leftIndex < participants.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < participants.length; rightIndex += 1) {
        const left = participants[leftIndex];
        const right = participants[rightIndex];
        if (!samePolity(left.polity || left.ownerCode, right.polity || right.ownerCode) &&
            !(explicitInPersonAccess(left) && explicitInPersonAccess(right))) {
          return {
            allowed: false,
            mode,
            reason: `${left.name} and ${right.name} cannot share a physical room without explicit access grants for both sides.`,
            blockedBy: `${left.id || left.name},${right.id || right.name}`,
          };
        }
      }
    }
  }

  return { allowed: true, mode, reason: "" };
};

export const canFigureJoinMeeting = (figure, options = {}) =>
  evaluateFigureMeeting({ ...options, figure }).allowed;
