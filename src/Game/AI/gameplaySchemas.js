const textSchema = (description) => ({
  type: "string",
  description,
});

const nonEmptyTextSchema = (description) => ({
  ...textSchema(description),
  minLength: 1,
});

const stringArraySchema = (description) => ({
  type: "array",
  description,
  items: { type: "string" },
});

const actionSchema = {
  type: "object",
  description: "One concrete action the player can take.",
  properties: {
    id: textSchema("Optional stable action identifier."),
    title: textSchema("Short display title for the action."),
    text: textSchema("Concrete, executable description of the action."),
    kind: textSchema('Action kind: usually "action", or "chat" only for a diplomatic conversation.'),
    invitees: stringArraySchema("Exact polity names invited when this is a chat action."),
    chatStarter: textSchema("Opening diplomatic message when this is a chat action."),
  },
  required: ["title", "text"],
  additionalProperties: false,
};

const chatCountrySchema = {
  type: "object",
  description: "A polity participating in a generated diplomatic chat.",
  properties: {
    code: textSchema("Polity's FULL country name (\"Spain\"), never a country code."),
    name: nonEmptyTextSchema("Exact polity name."),
  },
  required: ["name"],
  additionalProperties: false,
};

const chatMessageSchema = {
  type: "object",
  description: "An opening or follow-up message in a generated diplomatic chat.",
  properties: {
    code: textSchema("Speaker polity's FULL country name (\"Spain\"), never a country code."),
    role: textSchema("Message role, such as leader or system."),
    speaker: textSchema("Exact name of the speaker."),
    text: textSchema("Message body."),
    time: textSchema("In-game date or time, when relevant."),
  },
  required: ["text"],
  additionalProperties: false,
};

const createdChatSchema = {
  type: "object",
  description:
    "A diplomatic chat opened toward the player. The initiating polity ALWAYS "
    + "speaks first: title and openingMessage are required - a blank, untitled "
    + "chat tells the player nothing about why they were contacted.",
  properties: {
    id: textSchema("Optional stable chat identifier."),
    title: nonEmptyTextSchema("Short title naming the purpose of the chat (e.g. 'French mediation offer')."),
    countries: {
      type: "array",
      description: "Participating polities.",
      minItems: 1,
      items: chatCountrySchema,
    },
    messages: {
      type: "array",
      description: "Messages with which the chat begins.",
      items: chatMessageSchema,
    },
    openingMessage: nonEmptyTextSchema(
      "The initiating polity's first message, in its leader's voice - why it "
      + "reached out and what it wants. Never written as the player.",
    ),
    speaker: nonEmptyTextSchema("Name of the polity sending the opening message. Never the player's polity."),
    linkedEventId: textSchema("Optional event identifier linking this chat to its cause."),
    source: textSchema("Optional source label."),
    status: textSchema("Optional chat status."),
  },
  required: ["countries", "title", "speaker", "openingMessage"],
  additionalProperties: false,
};

const regionTransferSchema = {
  type: "object",
  description: "A transfer of one map region to a new polity owner.",
  properties: {
    regionId: textSchema(
      "Exact map region identifier when known; otherwise the region's plain name "
      + "(the engine resolves names to ids).",
    ),
    regionName: textSchema("Human-readable region name, when known."),
    fromCode: textSchema("Previous owner's FULL country name (\"Spain\"), never a country code."),
    toCode: textSchema("New owner's FULL country name (\"Spain\"), never a country code such as \"ESP\"."),
    note: textSchema("Brief reason for the transfer."),
    wholeCountry: {
      type: "boolean",
      description:
        "Set true ONLY for a total conquest, annexation, unification or partition in "
        + "which one polity takes EVERY region another still holds. Then put the losing "
        + "polity's name in regionId instead of a region name, and this single entry "
        + "transfers all of its territory. Leave unset (the normal case) to transfer "
        + "one named region.",
    },
  },
  required: ["regionId", "toCode"],
  additionalProperties: false,
};

// AI-authored updates to a country's PERSISTENT stat sheet (world.countryStats[code]).
// Only fields that CHANGED this period are sent; everything else persists. Absolute
// values, not deltas. Kept self-contained (no percentageSchema dep, which is defined
// later). LIVE via the tool schema, so it reaches existing frozen-prompt games.
const statPct = (description) => ({ type: "integer", minimum: 0, maximum: 100, description });
const statsUpdateSchema = {
  type: "object",
  description:
    "Updated national statistics for this polity. Include ONLY the fields that changed this period "
    + "(a coup changes leader/government/stability; a war changes reputation/economy) — every field you "
    + "omit keeps its previous value. Values are absolute, not deltas.",
  properties: {
    capital: textSchema("Capital, only when it changes."),
    continent: textSchema("Continent / broad region, only when it changes."),
    government: textSchema("Government system and ideology, only when it changes."),
    leader: textSchema("Head of state or government, only when it changes."),
    stability: statPct("National stability 0-100."),
    indices: {
      type: "object",
      properties: {
        sovereignty: statPct("Practical political sovereignty."),
        foodAutonomy: statPct("Domestic food autonomy."),
        energyAutonomy: statPct("Domestic energy autonomy."),
        economicIndependence: statPct("Economic independence."),
        internalSecurity: statPct("Internal security."),
        internationalReputation: statPct("International reputation / standing."),
      },
      additionalProperties: false,
    },
    economy: {
      type: "object",
      properties: {
        gdp: textSchema("GDP estimate."),
        gdpGrowth: textSchema("Annual GDP growth estimate."),
        gdpPerCapita: textSchema("GDP per capita estimate."),
        currency: textSchema("Currency."),
        inflation: textSchema("Inflation estimate."),
        unemployment: textSchema("Unemployment estimate."),
        publicDebt: textSchema("Public debt estimate."),
        budgetBalance: textSchema("Budget balance estimate."),
      },
      additionalProperties: false,
    },
    gdpBreakdown: {
      type: "object",
      description: "Agriculture/industry/services shares — send all three together so they still sum to ~100.",
      properties: {
        agriculture: statPct("Agriculture share of GDP."),
        industry: statPct("Industry share of GDP."),
        services: statPct("Services share of GDP."),
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const polityChangeSchema = {
  type: "object",
  description: "A creation, rename, recolor, or metadata change for a polity.",
  properties: {
    code: textSchema("Polity's exact FULL country name (\"Spain\"), never a country code."),
    name: textSchema("New polity name, only when it changes."),
    color: textSchema("New six-digit hexadecimal color, only when it changes."),
    aliases: stringArraySchema("Alternative polity names."),
    // The prompt asks for this and gameState normalizes/clamps/writes it, but it
    // was missing here — and additionalProperties:false means a json_schema
    // provider could never emit it, so international reputation silently never
    // moved. Declaring it is what actually connects that feature.
    reputation: {
      type: "number",
      description:
        "International reputation 0-100, only when it changes. 0 is a pariah state, 100 is universally trusted.",
    },
    tags: stringArraySchema(
      "The country's defining traits after this change — ideology, alignment, posture "
      + "(e.g. socialist, authoritarian, anti-nato). Only when they change: send the "
      + "COMPLETE new list, not a delta. A revolution or a change of alignment should "
      + "rewrite these.",
    ),
    note: textSchema("Brief reason for the change."),
    stats: statsUpdateSchema,
  },
  required: ["code"],
  additionalProperties: false,
};

const unitSchema = {
  type: "object",
  description: "A military unit to create on the map.",
  properties: {
    id: textSchema("Stable unit identifier."),
    name: nonEmptyTextSchema("Display name for the unit."),
    type: {
      type: "string",
      description: "Unit type.",
      enum: ["infantry", "armor", "air", "naval", "artillery", "garrison"],
    },
    ownerCode: nonEmptyTextSchema("Owning polity's FULL country name (\"Spain\"), never a country code."),
    strength: {
      type: "integer",
      description: "Unit strength from 1 to 1000.",
      minimum: 1,
      maximum: 1000,
    },
    lng: {
      type: "number",
      description: "Longitude of the unit location.",
      minimum: -180,
      maximum: 180,
    },
    lat: {
      type: "number",
      description: "Latitude of the unit location.",
      minimum: -90,
      maximum: 90,
    },
    regionId: textSchema("Map region identifier, when known."),
    sectorId: textSchema("Tactical sector identifier, when the unit is assigned to a front cell."),
    status: {
      type: "string",
      description: "Optional unit status.",
      enum: ["idle", "moving", "engaged", "pending"],
    },
    note: textSchema("Brief operational note."),
  },
  required: ["name", "type", "ownerCode", "strength", "lng", "lat"],
  additionalProperties: false,
};

const unitOpSchema = {
  description: "A unit mutation. Use op spawn, move, strength, or remove and fill the fields that op needs.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["spawn"] },
        unit: unitSchema,
      },
      required: ["op", "unit"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["move"] },
        unitId: nonEmptyTextSchema("Existing unit identifier."),
        toLng: { type: "number", minimum: -180, maximum: 180 },
        toLat: { type: "number", minimum: -90, maximum: 90 },
        regionId: textSchema("Destination region identifier, when known."),
        sectorId: textSchema("Destination tactical sector identifier, when known."),
        note: textSchema("Brief explanation of the operation."),
      },
      required: ["op", "unitId", "toLng", "toLat"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["strength"] },
        unitId: nonEmptyTextSchema("Existing unit identifier."),
        strength: { type: "integer", minimum: 0, maximum: 1000 },
        note: textSchema("Brief explanation of the operation."),
      },
      required: ["op", "unitId", "strength"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["remove"] },
        unitId: nonEmptyTextSchema("Existing unit identifier."),
        note: textSchema("Brief explanation of the operation."),
      },
      required: ["op", "unitId"],
      additionalProperties: false,
    },
  ],
};

const reserveSheetSchema = {
  type: "object",
  description: "Absolute military reserve snapshot for one polity. Numbers are counts or abstract stock units, not deltas.",
  properties: {
    manpower: { type: "integer", minimum: 0, description: "Uncommitted personnel available for mobilisation." },
    manpowerCommitted: { type: "integer", minimum: 0, description: "Personnel already committed to deployed formations." },
    equipment: {
      type: "object",
      description: "Ready reserve equipment counts keyed by type or named system.",
      additionalProperties: { type: "integer", minimum: 0 },
    },
    munitions: {
      type: "object",
      description: "Available ammunition or weapons stock keyed by category.",
      additionalProperties: { type: "integer", minimum: 0 },
    },
    fuel: { type: "integer", minimum: 0 },
    supplies: { type: "integer", minimum: 0 },
    maintenance: { type: "integer", minimum: 0, description: "Spare parts and maintenance capacity." },
    note: textSchema("Short logistics note."),
    updatedAt: textSchema("In-game date of this reserve report."),
  },
  additionalProperties: false,
};

const reserveOpSchema = {
  type: "object",
  description: "Replace or clear one polity's absolute military reserve snapshot.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["set", "update", "report"] },
        ownerCode: nonEmptyTextSchema("Polity whose reserves are being reported, as a FULL country name."),
        reserves: reserveSheetSchema,
      },
      required: ["op", "ownerCode", "reserves"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["clear", "remove"] },
        ownerCode: nonEmptyTextSchema("Polity whose reserve sheet is being cleared."),
      },
      required: ["op", "ownerCode"],
      additionalProperties: false,
    },
  ],
};

const resourceOpSchema = {
  type: "object",
  description:
    "A checked incremental logistics transaction. Use only when the starting reserve field is reported; missing data is unknown, not zero.",
  properties: {
    id: textSchema("Stable transaction identifier."),
    op: { type: "string", enum: ["consume", "produce", "set"] },
    ownerCode: nonEmptyTextSchema("Polity whose stock changes, as a FULL country name."),
    resource: {
      type: "string",
      enum: ["manpower", "manpowerCommitted", "equipment", "munitions", "fuel", "supplies", "maintenance"],
    },
    item: textSchema("Named equipment or munition item, required for equipment and munitions."),
    amount: { type: "integer", minimum: 0 },
    date: textSchema("In-game date of the transaction."),
    note: textSchema("Concrete accounting note, for example the units and reason spent."),
  },
  required: ["op", "ownerCode", "resource", "amount"],
  additionalProperties: false,
};

const forceDestinationSchema = {
  type: "object",
  description: "Optional rear-area destination. Omit it to keep units at their current coordinates while marking the withdrawal in progress.",
  properties: {
    lng: { type: "number", minimum: -180, maximum: 180 },
    lat: { type: "number", minimum: -90, maximum: 90 },
    regionId: textSchema("Destination region identifier."),
    sectorId: textSchema("Destination tactical sector identifier."),
  },
  required: ["lng", "lat"],
  additionalProperties: false,
};

const forceOpSchema = {
  type: "object",
  description:
    "A quantified order applied to every matching unit. Use this for a complete withdrawal or redeployment from a front; do not list only a convenient subset in unitOps.",
  properties: {
    id: textSchema("Stable order identifier."),
    op: { type: "string", enum: ["withdraw", "redeploy"] },
    ownerCode: nonEmptyTextSchema("Polity whose forces are ordered, as a FULL country name."),
    all: { type: "boolean", description: "Select every unit of ownerCode. Use only when the order explicitly covers the whole force." },
    unitIds: stringArraySchema("Exact unit ids to include."),
    regionIds: stringArraySchema("Exact source region ids to include."),
    sectorIds: stringArraySchema("Exact source tactical sector ids to include."),
    destination: forceDestinationSchema,
    note: textSchema("Short operational reason or destination note."),
  },
  required: ["op", "ownerCode"],
  additionalProperties: false,
  anyOf: [
    { required: ["all"] },
    { required: ["unitIds"] },
    { required: ["regionIds"] },
    { required: ["sectorIds"] },
  ],
};

const keyFigureSchema = {
  type: "object",
  description: "A persistent named person whose identity and current position matter to the timeline.",
  properties: {
    id: textSchema("Stable figure identifier; reuse it when updating the same person."),
    name: nonEmptyTextSchema("Person's full name."),
    role: textSchema("Current office, title, or role."),
    polity: textSchema("Polity associated with the person, as a FULL country name."),
    ownerCode: textSchema("Compatibility alias for polity, as a FULL country name."),
    status: {
      type: "string",
      enum: ["active", "deceased", "exiled", "imprisoned", "retired", "missing", "unknown"],
    },
    brainMode: { type: "string", enum: ["off", "light", "full"], description: "Orchestrator budget: off is a factual record only, light keeps compact motives, full enables a separate personal brain." },
    brainEnabled: { type: "boolean", description: "Whether the orchestrator currently keeps a separate personal brain active for this figure." },
    brainStatus: { type: "string", enum: ["active", "paused", "dormant", "retired"] },
    meetingModes: { type: "array", items: { type: "string", enum: ["cabinet", "secure-channel", "correspondence"] }, description: "Allowed contact channels for this figure." },
    meetingAccess: { type: "string", enum: ["normal", "restricted", "granted", "impossible"], description: "Whether exceptional in-person access has been explicitly granted." },
    birthDate: textSchema("Birth date or year, when known."),
    deathDate: textSchema("Death date or year, when known."),
    influence: { type: "integer", minimum: 0, maximum: 100, description: "Current political or military influence." },
    loyalty: { type: "integer", minimum: 0, maximum: 100, description: "Current loyalty to the associated polity or faction." },
    aliases: stringArraySchema("Alternative names or titles."),
    traits: stringArraySchema("Short stable traits relevant to future events."),
    goals: stringArraySchema("Current strategic goals, when materially known."),
    fears: stringArraySchema("Current fears or red lines, when materially known."),
    thought: textSchema("Current private thought, visible only in the figure dossier."),
    achievements: stringArraySchema("Short persistent achievements."),
    projects: stringArraySchema("Current research, production, or political projects."),
    location: textSchema("Current location, base, or region."),
    note: textSchema("Concise factual note about the person."),
    updatedAt: textSchema("In-game date of the last known update."),
  },
  required: ["name"],
  additionalProperties: false,
};

const keyFigureOpSchema = {
  description: "Create, update, or remove one persistent key figure.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["create", "set", "upsert", "add"] },
        figure: keyFigureSchema,
      },
      required: ["op", "figure"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["update", "patch"] },
        id: nonEmptyTextSchema("Existing key figure identifier."),
        figure: {
          type: "object",
          properties: keyFigureSchema.properties,
          additionalProperties: false,
        },
      },
      required: ["op", "id", "figure"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["remove", "delete"] },
        id: nonEmptyTextSchema("Existing key figure identifier."),
      },
      required: ["op", "id"],
      additionalProperties: false,
    },
  ],
};

const militaryIndustryEntrySchema = {
  type: "object",
  description: "One normalized record in arsenal, research, production, or the industrial ledger.",
  properties: {
    id: textSchema("Stable record identifier."),
    name: textSchema("Human-readable record or system name."),
    ownerCode: textSchema("Responsible polity's FULL country name."),
    polity: textSchema("Alias for ownerCode, as a FULL country name."),
    category: textSchema("Equipment or research category."),
    item: textSchema("Produced or tracked item."),
    kind: textSchema("Ledger entry kind."),
    status: textSchema("Current record status."),
    quantity: { type: "integer", minimum: 0, description: "Absolute quantity or output count." },
    amount: { type: "integer", minimum: 0, description: "Compatibility alias for quantity." },
    delta: { type: "integer", description: "Signed ledger change." },
    progress: { type: "integer", minimum: 0, maximum: 100, description: "Research or production completion percentage." },
    priority: { type: "integer", minimum: 0, maximum: 100, description: "Research or production priority." },
    facility: textSchema("Factory, arsenal, laboratory, or other facility."),
    location: textSchema("Location of the facility or stock."),
    date: textSchema("In-game date of the record."),
    startedAt: textSchema("In-game start date."),
    completedAt: textSchema("In-game completion date, when complete."),
    updatedAt: textSchema("In-game date of the last update."),
    note: textSchema("Short factual note."),
  },
  required: ["id"],
  additionalProperties: false,
};

const militaryIndustryOpSchema = {
  description: "Upsert, patch, append, or remove one military-industry record.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["produce", "consume"] },
        section: { type: "string", enum: ["arsenal"] },
        itemId: nonEmptyTextSchema("Stable arsenal item identifier."),
        name: textSchema("Human-readable item name."),
        ownerCode: textSchema("Responsible polity's FULL country name."),
        amount: { type: "integer", minimum: 1, description: "Positive number of units produced or consumed." },
        date: textSchema("In-game date."),
        note: textSchema("Concrete accounting note, including consumed manpower or equipment."),
        ledgerId: textSchema("Optional stable ledger identifier."),
      },
      required: ["op", "itemId", "amount"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["create", "set", "upsert", "add", "update", "patch", "record", "append"] },
        section: { type: "string", enum: ["arsenal", "research", "production", "ledger"] },
        id: textSchema("Stable record identifier; reused for later updates."),
        entry: militaryIndustryEntrySchema,
      },
      required: ["op", "section", "entry"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["remove", "delete"] },
        section: { type: "string", enum: ["arsenal", "research", "production", "ledger"] },
        id: nonEmptyTextSchema("Existing record identifier."),
      },
      required: ["op", "section", "id"],
      additionalProperties: false,
    },
  ],
};

const markerSchema = {
  type: "object",
  description:
    "A named structure on the map. kind is free-form lowercase - city, military base, "
    + "bunker, missile silo, embassy, port, airfield, factory, monument, or anything else.",
  properties: {
    id: textSchema("Stable marker identifier."),
    name: nonEmptyTextSchema("Display name of the structure."),
    kind: nonEmptyTextSchema("What the structure is, as a short lowercase noun phrase."),
    ownerCode: textSchema("Owning polity's FULL country name (\"Spain\") when owned, never a country code."),
    lng: {
      type: "number",
      description: "Longitude of the structure.",
      minimum: -180,
      maximum: 180,
    },
    lat: {
      type: "number",
      description: "Latitude of the structure.",
      minimum: -90,
      maximum: 90,
    },
    note: textSchema("Brief description shown when the structure is inspected."),
    foundedAt: textSchema("In-game date the structure was built or founded."),
  },
  required: ["name", "kind", "lng", "lat"],
  additionalProperties: false,
};

const markerOpSchema = {
  description: "A structure/place mutation. Use op build, remove, rename, or update and fill the fields that op needs.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["build"] },
        marker: markerSchema,
      },
      required: ["op", "marker"],
      additionalProperties: false,
    },
    // The same build, written flat. Models routinely put the structure's fields
    // beside `op` instead of nesting them under `marker`, and the engine has always
    // read that shape (normalizeMarkerOp falls back to the entry itself). Only this
    // schema refused it — and because a rejected op fails the WHOLE payload, one
    // flattened building threw away the entire turn and left the player with
    // fallback events. Accept what we already understand.
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["build"] },
        id: textSchema("Stable marker identifier."),
        name: nonEmptyTextSchema("Name of the structure or place."),
        kind: textSchema("What it is: city, base, bunker, silo, embassy, port."),
        ownerCode: textSchema("Owning polity's FULL country name (\"Spain\"), never a country code."),
        lng: { type: "number", description: "Longitude.", minimum: -180, maximum: 180 },
        lat: { type: "number", description: "Latitude.", minimum: -90, maximum: 90 },
        note: textSchema("Brief explanation."),
      },
      required: ["op", "name", "lng", "lat"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["remove"] },
        markerId: textSchema("Existing marker identifier, when known."),
        name: nonEmptyTextSchema("Name of the structure to remove."),
        note: textSchema("Brief explanation of the removal."),
      },
      required: ["op", "name"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["rename"] },
        markerId: textSchema("Existing marker identifier, when known."),
        name: nonEmptyTextSchema("Current name of the structure or city to rename."),
        newName: nonEmptyTextSchema("New display name."),
        note: textSchema("Brief explanation of the rename."),
      },
      required: ["op", "name", "newName"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["update", "annotate", "identify"] },
        markerId: textSchema("Existing marker identifier, preferred for player-placed markers."),
        name: nonEmptyTextSchema("Current marker name used to find it when markerId is unavailable."),
        newName: textSchema("New display name, when the marker is identified."),
        kind: textSchema("Updated marker kind, such as objective, city, front, supply depot, or base."),
        ownerCode: textSchema("Owning or controlling polity's FULL country name."),
        status: { type: "string", enum: ["pending", "identified", "active", "destroyed"] },
        note: textSchema("AI description or identification note."),
        foundedAt: textSchema("In-game date associated with the identified place."),
      },
      required: ["op"],
      additionalProperties: false,
    },
  ],
};

const controlSectorCellSchema = {
  type: "object",
  description: "A stable HOI-style tactical cell inside its parent sector. Change individual cells gradually during a prolonged battle.",
  properties: {
    id: nonEmptyTextSchema("Stable cell identifier; reuse it on later updates to the same local patch."),
    name: textSchema("Optional local label such as a village, road, suburb, or bridgehead."),
    parentCellId: textSchema("Optional parent cell identifier. Set this when splitting one existing cell into finer child cells."),
    depth: { type: "integer", minimum: 1, maximum: 2, description: "Cell hierarchy depth: 1 is the sector grid, 2 is the final micro-cell level. Never create depth 3." },
    ownerCode: nonEmptyTextSchema("Current cell controller's FULL country name, never a country code."),
    contestedBy: textSchema("Opposing polity's FULL country name when this cell is contested."),
    control: { type: "integer", minimum: 0, maximum: 100, description: "Approximate share of this cell's ground physically controlled by ownerCode." },
    center: {
      type: "object",
      properties: {
        lng: { type: "number", minimum: -180, maximum: 180 },
        lat: { type: "number", minimum: -90, maximum: 90 },
      },
      required: ["lng", "lat"],
      additionalProperties: false,
    },
    radiusKm: { type: "number", minimum: 0.5, maximum: 20, description: "Approximate tactical-cell radius in kilometres." },
    status: {
      type: "string",
      enum: ["assault", "contested", "encircled", "held", "withdrawn", "destroyed"],
    },
    note: textSchema("Short operational note for this cell."),
  },
  required: ["id", "ownerCode", "control", "center", "radiusKm"],
  additionalProperties: false,
};

const controlSectorCellOpSchema = {
  description: "A partial change to one tactical cell, used when only part of a front changes or one cell is split further.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["upsert"] },
        cell: controlSectorCellSchema,
      },
      required: ["op", "cell"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["remove"] },
        id: nonEmptyTextSchema("Existing cell identifier; removing a parent also removes its child cells."),
      },
      required: ["op", "id"],
      additionalProperties: false,
    },
  ],
};

const controlSectorSchema = {
  type: "object",
  description: "One connected tactical front inside an administrative region, not a new province. A bridgehead keeps one stable sector id and grows through touching cells; never create duplicate same-named sectors for pieces of one front.",
  properties: {
    id: nonEmptyTextSchema("Stable tactical sector identifier; reuse it on later updates to the same battle."),
    regionId: nonEmptyTextSchema("Containing map region identifier or exact region name."),
    name: nonEmptyTextSchema("Human-readable tactical sector name."),
    ownerCode: nonEmptyTextSchema("Current tactical controller's FULL country name, never a country code."),
    contestedBy: textSchema("Opposing polity's FULL country name when the sector is contested."),
    control: { type: "integer", minimum: 0, maximum: 100, description: "Area-weighted share of this tactical patch physically controlled by ownerCode." },
    center: {
      type: "object",
      properties: {
        lng: { type: "number", minimum: -180, maximum: 180 },
        lat: { type: "number", minimum: -90, maximum: 90 },
      },
      required: ["lng", "lat"],
      additionalProperties: false,
    },
    radiusKm: { type: "number", minimum: 0.5, maximum: 80, description: "Approximate radius of the tactical patch in kilometres." },
    status: {
      type: "string",
      enum: ["assault", "contested", "encircled", "held", "withdrawn", "destroyed"],
    },
    battleId: textSchema("Stable identifier for a prolonged battle; keep it across multiple jumps."),
    startedAt: textSchema("In-game date when this battle or sector first became active."),
    updatedAt: textSchema("In-game date of this update."),
    note: textSchema("Short operational note explaining the current state."),
    cells: {
      type: "array",
      minItems: 1,
      maxItems: 256,
      description: "Stable local cells inside this sector. Emit a full snapshot when the whole grid changes; use cellOps for partial changes.",
      items: controlSectorCellSchema,
    },
    cellOps: {
      type: "array",
      maxItems: 256,
      description: "Partial upsert/remove operations for cells. Use this to change only one approach or split one cell into finer child cells without rewriting the whole sector.",
      items: controlSectorCellOpSchema,
    },
  },
  required: ["id", "regionId", "name", "ownerCode", "control", "center"],
  additionalProperties: false,
};

const sectorOpSchema = {
  description: "Update or remove a tactical control patch without transferring the whole administrative region.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["upsert"] },
        sector: controlSectorSchema,
      },
      required: ["op", "sector"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["remove"] },
        id: nonEmptyTextSchema("Existing tactical sector identifier."),
      },
      required: ["op", "id"],
      additionalProperties: false,
    },
  ],
};

const territoryFragmentSchema = {
  type: "object",
  description:
    "A named subregion cut from one administrative region. Its geometry is made only from exact leaf-cell references, so it can be a new province, autonomous area, occupied pocket, or secession state without inventing a freehand polygon.",
  properties: {
    id: nonEmptyTextSchema("Stable fragment identifier, for example bakhmut-pocket-01."),
    name: nonEmptyTextSchema("Name of the new subregion, province, autonomous area, or state."),
    parentRegionId: nonEmptyTextSchema("Containing administrative map region id or exact region name."),
    ownerCode: nonEmptyTextSchema("Polity that owns or controls this fragment, as a FULL country name."),
    cellRefs: {
      type: "array",
      minItems: 1,
      maxItems: 256,
      items: nonEmptyTextSchema("Exact cell reference in the form sectorId:cellId; use leaf cells only."),
    },
    kind: textSchema("subregion, autonomy, occupation, secession, or new-state."),
    status: { type: "string", enum: ["proposed", "active", "dissolved"] },
    note: textSchema("Why this fragment exists and how it relates to the parent region."),
    foundedAt: textSchema("In-game date when the fragment was established."),
  },
  required: ["id", "name", "parentRegionId", "ownerCode", "cellRefs"],
  additionalProperties: false,
};

const territoryOpSchema = {
  description: "Create/update or dissolve a cell-backed subregion. Use this together with polityChanges when a new state is born.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["create", "upsert", "update", "split"] },
        fragment: territoryFragmentSchema,
      },
      required: ["op", "fragment"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["remove", "dissolve", "abolish"] },
        id: nonEmptyTextSchema("Existing territory fragment identifier."),
      },
      required: ["op", "id"],
      additionalProperties: false,
    },
  ],
};

const impactsSchema = {
  type: "object",
  description: "Optional structured world-state effects. Include only effect arrays that are relevant.",
  properties: {
    actionIds: stringArraySchema("Player action identifiers resolved by the event."),
    createdChats: {
      type: "array",
      description: "Diplomatic chats opened by the event.",
      items: createdChatSchema,
    },
    polityChanges: {
      type: "array",
      description: "Polity metadata changes.",
      items: polityChangeSchema,
    },
    keyFigureOps: {
      type: "array",
      description:
        "Persistent key-figure changes. Use absolute factual fields for a person; omit unchanged fields in a patch.",
      items: keyFigureOpSchema,
    },
    militaryIndustryOps: {
      type: "array",
      description:
        "Persistent military-industrial changes. Use arsenal for stocks, research for projects, production for active lines, and ledger for dated signed records.",
      items: militaryIndustryOpSchema,
    },
    regionTransfers: {
      type: "array",
      description:
        "Complete administrative-region ownership changes. REQUIRED when the whole named region was "
        + "annexed, ceded, liberated, or decisively occupied. For a city, bridgehead, road, district, "
        + "front advance, or any other partial capture inside the region, use sectorOps instead.",
      items: regionTransferSchema,
    },
    sectorOps: {
      type: "array",
      description: "Partial tactical control changes inside a region. Use connected cells for every local advance; control is occupied area, not visual opacity. Use regionTransfers only when the whole administrative region changes hands.",
      items: sectorOpSchema,
    },
    territoryOps: {
      type: "array",
      description:
        "Cell-backed administrative splits. Use when a piece of a region becomes a named subregion, autonomous area, occupation pocket, or new state; do not use regionTransfers for a partial cell cut.",
      items: territoryOpSchema,
    },
    unitOps: {
      type: "array",
      description: "Military unit operations.",
      items: unitOpSchema,
    },
    forceOps: {
      type: "array",
      description: "Quantified withdrawal or redeployment orders expanded against the complete current order of battle.",
      items: forceOpSchema,
    },
    reserveOps: {
      type: "array",
      description: "Absolute military reserve snapshots. Update this when mobilisation, casualties, resupply, production, or shortages materially change a polity's reserves.",
      items: reserveOpSchema,
    },
    resourceOps: {
      type: "array",
      description: "Checked incremental production/consumption transactions. The engine rejects unknown starting balances and insufficient stock instead of inventing or clamping them.",
      items: resourceOpSchema,
    },
    markerOps: {
      type: "array",
      description:
        "Structures built or destroyed on the map. Use whenever the event founds, "
        + "constructs, or destroys a named place - a city, military base, bunker, "
        + "missile silo, embassy, port - so the map shows it.",
      items: markerOpSchema,
    },
  },
  additionalProperties: false,
};

const eventSchema = {
  type: "object",
  description: "One dated campaign event produced by a timeline simulation.",
  properties: {
    id: textSchema("Optional stable event identifier."),
    date: textSchema("In-game date on which the event occurs."),
    title: textSchema("Concise event headline."),
    description: textSchema("Specific narrative description and consequences."),
    importance: textSchema("Importance label, normally minor or major."),
    kind: textSchema("Event category, such as world, player, diplomacy, or military."),
    notable: {
      type: "boolean",
      description: "Whether this event is important enough to stop an automatic jump.",
    },
    playerRelated: {
      type: "boolean",
      description: "Whether the event directly concerns the player polity.",
    },
    impacts: impactsSchema,
  },
  required: ["date", "title", "description"],
  additionalProperties: false,
};

const catalystSchema = {
  type: "object",
  description: "An interactive catalyst scene offered to the player.",
  properties: {
    title: textSchema("Short catalyst title."),
    premise: textSchema("Stable premise and stakes of the scene."),
    opening: textSchema("Immersive opening state requiring player input."),
    choices: {
      type: "array",
      description: "Two to five distinct choices available to the player.",
      minItems: 2,
      maxItems: 5,
      items: nonEmptyTextSchema("One player choice."),
    },
  },
  required: ["title", "premise", "opening", "choices"],
  additionalProperties: false,
};

const nullableCatalystSchema = {
  anyOf: [catalystSchema, { type: "null" }],
};

export const ACTIONS_SCHEMA = {
  type: "object",
  description: "Strategic topics of concern and concrete actions available under each topic.",
  properties: {
    topics: {
      type: "array",
      description: "Current strategic topics of concern.",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: textSchema("Optional stable topic identifier."),
          title: textSchema("Short title naming the concern."),
          description: textSchema("Why the concern matters now."),
          actions: {
            type: "array",
            description: "Concrete actions addressing this concern.",
            minItems: 1,
            items: actionSchema,
          },
        },
        required: ["title", "description", "actions"],
        additionalProperties: false,
      },
    },
  },
  required: ["topics"],
  additionalProperties: false,
};

export const JUMP_FORWARD_SCHEMA = {
  type: "object",
  description: "A simulated timeline jump containing dated events and the resulting campaign state.",
  properties: {
    events: {
      type: "array",
      description: "Events occurring during the simulated period.",
      items: eventSchema,
    },
    stopDate: textSchema("Date at which the simulation stops."),
    summary: textSchema("Concise summary of the period and its strategic consequences."),
    clearActions: {
      type: "boolean",
      description: "Whether planned player actions were resolved by this jump.",
    },
    catalyst: nullableCatalystSchema,
    diplomaticOutreach: {
      type: "array",
      description:
        "Polities reaching out to the player ON THEIR OWN initiative - treaty "
        + "feelers, trade proposals, warnings, summit invitations - not tied to "
        + "any single event. One-on-one or group. Empty when nobody would "
        + "plausibly reach out this period.",
      items: createdChatSchema,
    },
  },
  required: ["events", "stopDate", "summary", "clearActions"],
  additionalProperties: false,
};

export const AUTO_JUMP_FORWARD_SCHEMA = JUMP_FORWARD_SCHEMA;

// Backstory events deliberately have NO impacts field: the scenario's world
// state already reflects everything that happened before round one, so a
// pre-game event is a record, never a change to apply.
const pregameEventSchema = {
  type: "object",
  description: "One dated historical event from BEFORE the game's start date.",
  properties: {
    date: textSchema("Date the event occurred, strictly before the game start date."),
    title: textSchema("Concise event headline."),
    description: textSchema("Specific narrative description and its consequences."),
    importance: textSchema("Importance label, normally minor or major."),
    kind: textSchema("Event category, such as world, player, diplomacy, or military."),
  },
  required: ["date", "title", "description"],
  additionalProperties: false,
};

export const PREGAME_HISTORY_SCHEMA = {
  type: "object",
  description: "The pre-game backstory: the events that led up to the start of the campaign.",
  properties: {
    events: {
      type: "array",
      description: "Chronological events from before round one, oldest first.",
      minItems: 1,
      maxItems: 12,
      items: pregameEventSchema,
    },
    summary: textSchema("One-paragraph summary of the era leading into the start date."),
  },
  required: ["events", "summary"],
  additionalProperties: false,
};

// The idle-time diplomatic drip: while the player sits between jumps, a polity
// may send a short note to their inbox. `chat: null` means nobody plausibly
// would right now - silence is the common, correct answer.
export const IDLE_DIPLOMACY_SCHEMA = {
  type: "object",
  description: "At most one short unprompted diplomatic note to the player, or null for silence.",
  properties: {
    chat: {
      anyOf: [
        { type: "null", description: "No polity would plausibly reach out right now." },
        createdChatSchema,
      ],
    },
  },
  required: ["chat"],
  additionalProperties: false,
};

export const DESCRIPTION_TO_ACTION_SCHEMA = {
  type: "object",
  description: "One structured game command converted from the player's freeform intent.",
  properties: {
    title: textSchema("Short display title for the command."),
    text: textSchema("Expanded command with enough detail for timeline simulation."),
    kind: textSchema('Command kind: "action" unless the player explicitly asked to open a diplomatic chat.'),
    invitees: stringArraySchema("Exact polity names invited to a chat; empty for a normal action."),
    chatStarter: textSchema("Opening message for a chat; empty for a normal action."),
  },
  required: ["title", "text", "kind"],
  additionalProperties: false,
};

export const NEXT_SPEAKER_SCHEMA = {
  type: "object",
  description: "The exact participant who should speak next in the diplomatic chat.",
  properties: {
    nextSpeaker: textSchema("Exact name of one chat participant other than the most recent speaker."),
  },
  required: ["nextSpeaker"],
  additionalProperties: false,
};

export const FIGURE_BRAIN_SCHEMA = {
  type: "object",
  description: "A private response from one key figure, with optional validated state proposals.",
  properties: {
    reply: nonEmptyTextSchema("The figure's spoken reply in their own voice."),
    thought: textSchema("Private current thought to persist for this figure."),
    achievement: {
      type: "object",
      properties: {
        title: textSchema("Short achievement title."),
        summary: textSchema("What the figure accomplished or learned."),
      },
      required: [],
      additionalProperties: false,
    },
    figureOps: { type: "array", items: keyFigureOpSchema },
    industryOps: { type: "array", items: militaryIndustryOpSchema },
    reserveOps: { type: "array", items: reserveOpSchema },
    ledger: {
      type: "object",
      properties: {
        spent: { type: "array", items: textSchema("Resource expenditure summary.") },
        produced: { type: "array", items: textSchema("Production summary.") },
      },
      required: [],
      additionalProperties: false,
    },
  },
  required: ["reply"],
  additionalProperties: false,
};

export const EVENT_CONSOLIDATOR_SCHEMA = {
  type: "object",
  description: "A continuity-safe summary of the supplied events and diplomatic chats.",
  properties: {
    summary: textSchema("Concise campaign history preserving major events, map changes, and diplomatic commitments."),
  },
  required: ["summary"],
  additionalProperties: false,
};

export const CATALYST_CREATION_SCHEMA = catalystSchema;

export const CATALYST_EXECUTOR_SCHEMA = {
  type: "object",
  description: "The next stage of an active catalyst after applying the player's choice.",
  properties: {
    summary: textSchema("Narration of the player's action, reactions, and resulting situation."),
    resolved: {
      type: "boolean",
      description: "Whether the catalyst has reached a definite conclusion.",
    },
    nextChoices: {
      type: "array",
      description: "Two to five choices for an unresolved next stage; empty when resolved.",
      maxItems: 5,
      items: nonEmptyTextSchema("One player choice."),
    },
  },
  required: ["summary", "resolved", "nextChoices"],
  additionalProperties: false,
};

export const CATALYST_SUMMARY_SCHEMA = {
  type: "object",
  description: "A resolved catalyst condensed into one campaign timeline event.",
  properties: {
    title: textSchema("Concise event headline."),
    description: textSchema("Complete but concise account of the catalyst outcome."),
    importance: textSchema("Event importance, normally major."),
  },
  required: ["title", "description", "importance"],
  additionalProperties: false,
};

export const GAME_MASTER_SCHEMA = {
  type: "object",
  description: "A direct game-master intervention and its structured world-state changes.",
  properties: {
    summary: textSchema("Concise account of how the GM request changed the world."),
    impacts: impactsSchema,
  },
  required: ["summary", "impacts"],
  additionalProperties: false,
};

const percentageSchema = (description) => ({
  type: "integer",
  description,
  minimum: 0,
  maximum: 100,
});

export const COUNTRY_STAT_SHEET_SCHEMA = {
  type: "object",
  description: "A complete national statistics sheet for the selected polity.",
  properties: {
    capital: nonEmptyTextSchema("Capital or primary seat of government."),
    continent: nonEmptyTextSchema("Continent or broad geographic region."),
    government: nonEmptyTextSchema("Government system and ideology."),
    leader: nonEmptyTextSchema("Head of state or government."),
    stability: percentageSchema("National stability from 0 to 100."),
    indices: {
      type: "object",
      properties: {
        sovereignty: percentageSchema("Practical political sovereignty."),
        foodAutonomy: percentageSchema("Domestic food autonomy."),
        energyAutonomy: percentageSchema("Domestic energy autonomy."),
        economicIndependence: percentageSchema("Economic independence."),
        internalSecurity: percentageSchema("Internal security."),
        internationalReputation: percentageSchema("International reputation / standing (0-100)."),
      },
      required: ["sovereignty", "foodAutonomy", "energyAutonomy", "economicIndependence", "internalSecurity", "internationalReputation"],
      additionalProperties: false,
    },
    economy: {
      type: "object",
      properties: {
        gdp: nonEmptyTextSchema("Era-appropriate gross domestic product estimate."),
        gdpGrowth: nonEmptyTextSchema("Annual GDP growth estimate."),
        gdpPerCapita: nonEmptyTextSchema("Era-appropriate GDP per capita estimate."),
        currency: nonEmptyTextSchema("Currency or dominant medium of exchange."),
        inflation: nonEmptyTextSchema("Inflation estimate."),
        unemployment: nonEmptyTextSchema("Unemployment estimate."),
        publicDebt: nonEmptyTextSchema("Public debt estimate."),
        budgetBalance: nonEmptyTextSchema("Budget surplus or deficit estimate."),
      },
      required: ["gdp", "gdpGrowth", "gdpPerCapita", "currency", "inflation", "unemployment", "publicDebt", "budgetBalance"],
      additionalProperties: false,
    },
    gdpBreakdown: {
      type: "object",
      properties: {
        agriculture: percentageSchema("Agriculture share of GDP."),
        industry: percentageSchema("Industry share of GDP."),
        services: percentageSchema("Services share of GDP."),
      },
      required: ["agriculture", "industry", "services"],
      additionalProperties: false,
    },
  },
  required: ["capital", "continent", "government", "leader", "stability", "indices", "economy", "gdpBreakdown"],
  additionalProperties: false,
};

export const GAMEPLAY_SCHEMAS = Object.freeze({
  actions: ACTIONS_SCHEMA,
  jumpForward: JUMP_FORWARD_SCHEMA,
  autoJumpForward: AUTO_JUMP_FORWARD_SCHEMA,
  descriptionToAction: DESCRIPTION_TO_ACTION_SCHEMA,
  nextSpeaker: NEXT_SPEAKER_SCHEMA,
  figureBrain: FIGURE_BRAIN_SCHEMA,
  eventConsolidator: EVENT_CONSOLIDATOR_SCHEMA,
  catalystCreation: CATALYST_CREATION_SCHEMA,
  catalystExecutor: CATALYST_EXECUTOR_SCHEMA,
  catalystSummary: CATALYST_SUMMARY_SCHEMA,
  gameMaster: GAME_MASTER_SCHEMA,
  countryStatSheet: COUNTRY_STAT_SHEET_SCHEMA,
  idleDiplomacy: IDLE_DIPLOMACY_SCHEMA,
  pregameHistory: PREGAME_HISTORY_SCHEMA,
});

const makeTool = (name, description, schema) => Object.freeze({ name, description, schema });

export const ACTIONS_TOOL = makeTool(
  "submit_actions",
  "Submit strategic topics of concern and their suggested player actions.",
  ACTIONS_SCHEMA,
);

export const JUMP_FORWARD_TOOL = makeTool(
  "submit_jump_result",
  "Submit the events, stop date, summary, resolved-action state, and optional catalyst from a timeline jump.",
  JUMP_FORWARD_SCHEMA,
);

export const AUTO_JUMP_FORWARD_TOOL = makeTool(
  "submit_jump_result",
  "Submit the events and result of an automatic timeline jump that stops at the next notable moment.",
  AUTO_JUMP_FORWARD_SCHEMA,
);

export const DESCRIPTION_TO_ACTION_TOOL = makeTool(
  "submit_description_to_action",
  "Submit the structured action or diplomatic chat command derived from the player's freeform intent.",
  DESCRIPTION_TO_ACTION_SCHEMA,
);

export const NEXT_SPEAKER_TOOL = makeTool(
  "submit_next_speaker",
  "Submit the exact diplomatic chat participant who should speak next.",
  NEXT_SPEAKER_SCHEMA,
);

export const FIGURE_BRAIN_TOOL = makeTool(
  "submit_figure_brain",
  "Submit a key figure's private reply and optional validated figure or industry updates.",
  FIGURE_BRAIN_SCHEMA,
);

export const EVENT_CONSOLIDATOR_TOOL = makeTool(
  "submit_event_consolidation",
  "Submit a concise continuity summary of the supplied campaign events and chats.",
  EVENT_CONSOLIDATOR_SCHEMA,
);

export const CATALYST_CREATION_TOOL = makeTool(
  "submit_catalyst_creation",
  "Submit a new interactive catalyst scene and the choices available to the player.",
  CATALYST_CREATION_SCHEMA,
);

export const CATALYST_EXECUTOR_TOOL = makeTool(
  "submit_catalyst_execution",
  "Submit the result of the player's catalyst choice and either new choices or a resolved state.",
  CATALYST_EXECUTOR_SCHEMA,
);

export const CATALYST_SUMMARY_TOOL = makeTool(
  "submit_catalyst_summary",
  "Submit the final campaign event produced by a resolved catalyst.",
  CATALYST_SUMMARY_SCHEMA,
);

export const GAME_MASTER_TOOL = makeTool(
  "submit_game_master",
  "Submit the summary and structured map or world-state effects of a game-master request.",
  GAME_MASTER_SCHEMA,
);

export const COUNTRY_STAT_SHEET_TOOL = makeTool(
  "submit_country_stat_sheet",
  "Submit the complete validated national statistics sheet.",
  COUNTRY_STAT_SHEET_SCHEMA,
);

export const IDLE_DIPLOMACY_TOOL = makeTool(
  "submit_idle_diplomacy",
  "Submit at most one short unprompted diplomatic note to the player, or null for silence.",
  IDLE_DIPLOMACY_SCHEMA,
);

export const PREGAME_HISTORY_TOOL = makeTool(
  "submit_pregame_history",
  "Submit the pre-game backstory events that led up to the campaign's start date.",
  PREGAME_HISTORY_SCHEMA,
);

export const GAMEPLAY_TOOLS = Object.freeze({
  actions: ACTIONS_TOOL,
  jumpForward: JUMP_FORWARD_TOOL,
  autoJumpForward: AUTO_JUMP_FORWARD_TOOL,
  descriptionToAction: DESCRIPTION_TO_ACTION_TOOL,
  nextSpeaker: NEXT_SPEAKER_TOOL,
  figureBrain: FIGURE_BRAIN_TOOL,
  eventConsolidator: EVENT_CONSOLIDATOR_TOOL,
  catalystCreation: CATALYST_CREATION_TOOL,
  catalystExecutor: CATALYST_EXECUTOR_TOOL,
  catalystSummary: CATALYST_SUMMARY_TOOL,
  gameMaster: GAME_MASTER_TOOL,
  countryStatSheet: COUNTRY_STAT_SHEET_TOOL,
  idleDiplomacy: IDLE_DIPLOMACY_TOOL,
  pregameHistory: PREGAME_HISTORY_TOOL,
});

export const getGameplayTool = (taskKey) => GAMEPLAY_TOOLS[taskKey] ?? null;

const valueType = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const propertyPath = (path, key) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

const validateAgainstSchema = (schema, value, path) => {
  if (Array.isArray(schema.anyOf)) {
    const errors = schema.anyOf.map((candidate) => validateAgainstSchema(candidate, value, path));
    if (errors.some((error) => !error)) return "";
    return `${path} did not match any allowed schema: ${errors.join(" ")}`;
  }

  const actualType = valueType(value);
  const typeMatches = schema.type === "integer"
    ? actualType === "number" && Number.isInteger(value)
    : !schema.type || actualType === schema.type;
  if (!typeMatches) {
    return `${path} must be ${schema.type}; received ${valueType(value)}.`;
  }

  if ((schema.type === "number" || schema.type === "integer") && !Number.isFinite(value)) {
    return `${path} must be a finite number.`;
  }

  if ((schema.type === "number" || schema.type === "integer") && Number.isFinite(schema.minimum) && value < schema.minimum) {
    return `${path} must be at least ${schema.minimum}.`;
  }

  if ((schema.type === "number" || schema.type === "integer") && Number.isFinite(schema.maximum) && value > schema.maximum) {
    return `${path} must be at most ${schema.maximum}.`;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `${path} must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}.`;
  }

  if (schema.type === "string" && Number.isFinite(schema.minLength) && value.length < schema.minLength) {
    return `${path} must contain at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}.`;
  }

  if (schema.type === "array") {
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) {
      return `${path} must contain at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}.`;
    }
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) {
      return `${path} must contain at most ${schema.maxItems} items.`;
    }

    for (let index = 0; index < value.length; index += 1) {
      const error = validateAgainstSchema(schema.items ?? {}, value[index], `${path}[${index}]`);
      if (error) return error;
    }
  }

  if (schema.type === "object") {
    const properties = schema.properties ?? {};

    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        return `${propertyPath(path, key)} is required.`;
      }
    }

    for (const [key, entry] of Object.entries(value)) {
      const childSchema = properties[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) {
          return `${propertyPath(path, key)} is not allowed.`;
        }
        continue;
      }

      const error = validateAgainstSchema(childSchema, entry, propertyPath(path, key));
      if (error) return error;
    }
  }

  return "";
};

const hasMeaningfulCatalyst = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  ([value.title, value.premise, value.opening].some(
    (entry) => typeof entry === "string" && entry.trim().length > 0,
  ) ||
    (Array.isArray(value.choices) && value.choices.length > 0));

const validateDistinctChoices = (choices, path) => {
  const normalized = choices.map((choice) => choice.trim().toLocaleLowerCase());
  const blankIndex = normalized.findIndex((choice) => !choice);
  if (blankIndex >= 0) return `${path}[${blankIndex}] must not be blank.`;
  if (new Set(normalized).size !== normalized.length) return `${path} must contain distinct choices.`;
  return "";
};

const findBlankString = (value, path = "$") => {
  if (typeof value === "string") return value.trim() ? "" : `${path} must not be blank.`;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const error = findBlankString(value[index], `${path}[${index}]`);
      if (error) return error;
    }
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const error = findBlankString(entry, propertyPath(path, key));
      if (error) return error;
    }
  }
  return "";
};

export const validateGameplayPayload = (taskKey, value) => {
  const schema = GAMEPLAY_SCHEMAS[taskKey];
  if (!schema) {
    return {
      valid: false,
      error: `Unknown gameplay task key: ${String(taskKey)}.`,
    };
  }

  const error = validateAgainstSchema(schema, value, "$");
  if (error) {
    return { valid: false, error };
  }

  if (taskKey === "jumpForward" || taskKey === "autoJumpForward") {
    if (!value.stopDate.trim()) {
      return { valid: false, error: "$.stopDate must not be empty." };
    }
    for (let index = 0; index < value.events.length; index += 1) {
      const event = value.events[index];
      for (const field of ["date", "title", "description"]) {
        if (!event[field].trim()) {
          return { valid: false, error: `$.events[${index}].${field} must not be empty.` };
        }
      }
    }
    const hasEvents = value.events.length > 0;
    const hasSummary = value.summary.trim().length > 0;
    if (!hasEvents && !hasSummary && !hasMeaningfulCatalyst(value.catalyst)) {
      return {
        valid: false,
        error: "Jump payload must contain at least one event, a nonempty summary, or a meaningful catalyst.",
      };
    }
    if (value.catalyst) {
      const catalystError = validateDistinctChoices(value.catalyst.choices, "$.catalyst.choices");
      if (catalystError) return { valid: false, error: catalystError };
    }
  }

  if (taskKey === "pregameHistory") {
    for (let index = 0; index < value.events.length; index += 1) {
      const event = value.events[index];
      for (const field of ["date", "title", "description"]) {
        if (!event[field].trim()) {
          return { valid: false, error: `$.events[${index}].${field} must not be empty.` };
        }
      }
    }
    if (!value.summary.trim()) {
      return { valid: false, error: "$.summary must not be empty." };
    }
  }

  const requiredTextByTask = {
    descriptionToAction: ["title", "text", "kind"],
    nextSpeaker: ["nextSpeaker"],
    figureBrain: ["reply"],
    eventConsolidator: ["summary"],
    catalystCreation: ["title", "premise", "opening"],
    catalystExecutor: ["summary"],
    catalystSummary: ["title", "description", "importance"],
    gameMaster: ["summary"],
  };
  for (const field of requiredTextByTask[taskKey] ?? []) {
    if (!value[field].trim()) {
      return { valid: false, error: `$.${field} must not be empty.` };
    }
  }

  if (taskKey === "catalystCreation") {
    const choiceError = validateDistinctChoices(value.choices, "$.choices");
    if (choiceError) return { valid: false, error: choiceError };
  }

  if (taskKey === "catalystExecutor") {
    if (value.resolved && value.nextChoices.length !== 0) {
      return { valid: false, error: "$.nextChoices must be empty when $.resolved is true." };
    }
    if (!value.resolved && value.nextChoices.length < 2) {
      return { valid: false, error: "$.nextChoices must contain between 2 and 5 choices while unresolved." };
    }
    const choiceError = validateDistinctChoices(value.nextChoices, "$.nextChoices");
    if (choiceError) return { valid: false, error: choiceError };
  }

  if (taskKey === "countryStatSheet") {
    const blankError = findBlankString(value);
    if (blankError) return { valid: false, error: blankError };
    const breakdown = value.gdpBreakdown;
    if (breakdown.agriculture + breakdown.industry + breakdown.services !== 100) {
      return { valid: false, error: "$.gdpBreakdown percentages must sum to 100." };
    }
  }

  if (taskKey === "actions") {
    for (let topicIndex = 0; topicIndex < value.topics.length; topicIndex += 1) {
      const topic = value.topics[topicIndex];
      if (!topic.title.trim()) return { valid: false, error: `$.topics[${topicIndex}].title must not be empty.` };
      for (let actionIndex = 0; actionIndex < topic.actions.length; actionIndex += 1) {
        const action = topic.actions[actionIndex];
        if (!action.title.trim() || !action.text.trim()) {
          return { valid: false, error: `$.topics[${topicIndex}].actions[${actionIndex}] must have nonempty title and text.` };
        }
      }
    }
  }

  return { valid: true, error: "" };
};
