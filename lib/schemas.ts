import { z } from 'zod';

export const AgentStatusSchema = z.enum(['active', 'idle', 'training', 'planned']);
export const AgentTierSchema = z.enum(['lead', 'specialist', 'worker']);
export const ToolStatusSchema = z.enum(['connected', 'available', 'planned']);
export const RoadmapStatusSchema = z.enum(['done', 'now', 'next', 'later']);

export const DepartmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  tagline: z.string(),
  color: z.string().min(1),
  order: z.number().int(),
});

export const AgentSchema = z.object({
  id: z.string().min(1),
  departmentId: z.string().min(1),
  name: z.string().min(1),
  role: z.string(),
  status: AgentStatusSchema,
  tier: AgentTierSchema,
  description: z.string(),
  model: z.string(),
  tools: z.array(z.string()),
  // parentId nests sub-agents under the agent doing the delegating;
  // instance names the runtime that will host this agent ('builtin' today,
  // an OpenClaw/Claude Code instance name once the dedicated host is live).
  parentId: z.string().nullable().default(null),
  instance: z.string().min(1).default('builtin'),
});

export const ToolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  status: ToolStatusSchema,
  color: z.string().min(1),
  description: z.string(),
});

// Integration = one entry in the connections marketplace: a brand, a one-line
// blurb, a category, and an optional link to a real connector that drives its
// live "connected" state. Logo comes from `slug` via lib/brand-logos.
export const INTEGRATION_CATEGORIES = [
  'Productivity',
  'Communication',
  'CRM & Sales',
  'Developer',
  'Scheduling',
  'Finance',
  'Marketing',
  'Storage',
  'Knowledge',
  'AI & Automation',
  'Creative',
] as const;
export const IntegrationCategorySchema = z.enum(INTEGRATION_CATEGORIES);
export const IntegrationSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  tagline: z.string().min(1),
  category: IntegrationCategorySchema,
  // when set, the catalog entry reflects this real connector's live state
  connectorId: z.string().min(1).optional(),
  popular: z.boolean().optional(),
  // env var names the connect flow may write to .env.local for this entry.
  // Omitted = a generic <SLUG>_API_KEY; [] = not key-connectable (guidance only).
  envKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).optional(),
});
export type Integration = z.infer<typeof IntegrationSchema>;
export type IntegrationCategory = z.infer<typeof IntegrationCategorySchema>;

export const RoadmapItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/, 'quarter must look like 2026-Q2'),
  status: RoadmapStatusSchema,
  departmentId: z.string().nullable(),
  description: z.string(),
});

export const MetricSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number(),
  unit: z.string(),
  delta: z.number(),
  period: z.string(),
});

export const AgentRunSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  ok: z.boolean(),
  summary: z.string(),
});

export const BroadcastReplySchema = z.object({
  id: z.string().min(1),
  broadcastId: z.string().min(1),
  agentId: z.string().min(1),
  ok: z.boolean(),
  reply: z.string(),
  finishedAt: z.string().min(1),
});

export const BroadcastSchema = z.object({
  id: z.string().min(1),
  message: z.string().min(1),
  createdAt: z.string().min(1),
  replies: z.array(BroadcastReplySchema),
});

export const AgentMessageRoleSchema = z.enum(['user', 'assistant', 'tool']);

export const AgentToolCallSchema = z.object({
  name: z.string().min(1),
  args: z.unknown(),
  result: z.unknown(),
});

export const AgentMessageSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  role: AgentMessageRoleSchema,
  content: z.string(),
  toolCalls: z.array(AgentToolCallSchema).default([]),
  createdAt: z.string().min(1),
});

export const ActivityEventSchema = z.object({
  kind: z.enum(['run', 'message', 'broadcast']),
  agentId: z.string().min(1),
  at: z.string().min(1),
  summary: z.string(),
  ok: z.boolean().optional(),
});

export const BrainOverviewSchema = z.object({
  store: z.object({
    path: z.string().min(1),
    totalFiles: z.number().int().nonnegative(),
    folders: z.array(z.object({ name: z.string().min(1), files: z.number().int().positive() })),
  }),
  doctor: z.object({
    connected: z.boolean(),
    status: z.string().min(1),
    healthScore: z.number().nullable(),
    checks: z.array(z.object({ name: z.string(), status: z.string(), message: z.string() })),
    detail: z.string(),
    version: z.string().nullable().optional(),
  }),
});

export const BrainGraphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['folder', 'page']),
  label: z.string().min(1),
  folder: z.string().min(1),
  kind: z.string().min(1), // color-key for future per-type/per-person color coding
  excerpt: z.string(),
  wordCount: z.number().int().nonnegative(),
  tags: z.array(z.string()),
  agents: z.array(z.string()),
  vx: z.number().min(-1).max(1), // embedding projection coords
  vy: z.number().min(-1).max(1),
  vector: z.array(z.number()), // 64-dim lexical embedding fingerprint
  chunks: z.number().int().nonnegative(), // embedding-pipeline chunk count
});

export const BrainGraphEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.enum(['member', 'wikilink', 'similar']),
});

export const BrainGraphSchema = z.object({
  nodes: z.array(BrainGraphNodeSchema),
  edges: z.array(BrainGraphEdgeSchema),
  // PCA basis of the store's embedding space, so the client can project
  // a live query vector into the same 2D plane the nodes occupy.
  space: z.object({
    dim: z.number().int().positive(),
    mean: z.array(z.number()),
    components: z.array(z.array(z.number())).length(2),
    scale: z.number(),
  }),
});

export const PhaseSchema = z.object({
  id: z.string().min(1),
  number: z.number().int(),
  title: z.string().min(1),
  items: z.array(z.string()),
});

export const LifeMapNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['center', 'area', 'module', 'tier']),
  label: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  parent: z.string().nullable(),
  detail: z.string(),
  agents: z.array(z.string()),
  brainFolders: z.array(z.string()),
});

export const LifeMapSchema = z.object({
  nodes: z.array(LifeMapNodeSchema),
  edges: z.array(z.object({ source: z.string().min(1), target: z.string().min(1) })),
});

/** `blocked` is the honest form of the reference UI's "On hold": the work is
 *  waiting on the operator, and the card says what for. */
export const AgentTaskStatusSchema = z.enum(['open', 'doing', 'blocked', 'done']);
export type AgentTaskStatus = z.infer<typeof AgentTaskStatusSchema>;

export const AgentTaskPrioritySchema = z.enum(['low', 'normal', 'high']);
export type AgentTaskPriority = z.infer<typeof AgentTaskPrioritySchema>;

/** Two lanes on one board: `me` is the operator's own list, `agent` is fleet
 *  work. Delegating a task flips it from one to the other. */
export const AgentTaskOwnerKindSchema = z.enum(['agent', 'me']);
export type AgentTaskOwnerKind = z.infer<typeof AgentTaskOwnerKindSchema>;

/** Grouping for the To-Do rail. Null means ungrouped. */
export const AgentTaskHorizonSchema = z.enum(['week', 'month', 'quarter', 'someday']);
export type AgentTaskHorizon = z.infer<typeof AgentTaskHorizonSchema>;

export const AgentTaskSchema = z
  .object({
    id: z.string().min(1),
    /** null only for the operator's own tasks; fleet work always names an agent */
    agentId: z.string().min(1).nullable().default(null),
    title: z.string().min(1),
    status: AgentTaskStatusSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    /** the instruction body the card expands to show */
    detail: z.string().default(''),
    /** ISO. Only a task that carries one can ever be overdue — the Overdue
     *  tile reads "—" rather than a flattering zero when none are set. */
    dueAt: z.string().nullable().default(null),
    priority: AgentTaskPrioritySchema.default('normal'),
    ownerKind: AgentTaskOwnerKindSchema.default('agent'),
    horizon: AgentTaskHorizonSchema.nullable().default(null),
    /** the agent_run that executed this task, once one has */
    runId: z.string().nullable().default(null),
  })
  .superRefine((t, ctx) => {
    if (t.ownerKind === 'agent' && !t.agentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agentId'],
        message: 'agent-owned tasks must name an agent',
      });
    }
  });

/** GladOS-side overlay on a bdpilot brand-deal thread: outcome tracking and
 *  a human-set quote. Never written to the daemon's state file. */
/** Manual system-setup check-off: only steps no code can verify. */
export const SetupCheckSchema = z.object({
  id: z.string().min(1),
  doneAt: z.string().min(1),
});
export type SetupCheck = z.infer<typeof SetupCheckSchema>;

export const BrandDealOutcomeSchema = z.enum(['open', 'won', 'lost', 'skipped']);
export const BrandDealOverrideSchema = z.object({
  dealId: z.string().min(1),
  outcome: BrandDealOutcomeSchema,
  amountUsd: z.number().int().positive().nullable(),
  updatedAt: z.string().min(1),
});
export type BrandDealOutcome = z.infer<typeof BrandDealOutcomeSchema>;
export type BrandDealOverride = z.infer<typeof BrandDealOverrideSchema>;

export const AgentCronSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  schedule: z.string().min(1), // 5-field cron, validated at the repo boundary
  description: z.string().min(1),
  enabled: z.boolean(),
  createdAt: z.string().min(1),
});

export const SocialPlatformSchema = z.enum(['instagram', 'tiktok', 'twitter', 'youtube', 'linkedin']);

export const SocialAccountSchema = z.object({
  platform: SocialPlatformSchema,
  handle: z.string().min(1),
  url: z.string().nullable(),
  order: z.number().int(),
});

// One row per platform per day. History accrues from the Zernio config on
// every dashboard read; the operator's own scrapes can insert richer rows later.
export const SocialSnapshotSchema = z.object({
  platform: SocialPlatformSchema,
  capturedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'capturedAt must look like 2026-06-13'),
  followers: z.number().int().nonnegative(),
  source: z.string().min(1),
});

// null = not enough history yet (honest, never a fake zero)
export const SocialGrowthSchema = z.object({
  d7: z.number().nullable(),
  d30: z.number().nullable(),
  d60: z.number().nullable(),
  allTime: z.number().nullable(),
});

export const SocialPlatformStatsSchema = z.object({
  platform: SocialPlatformSchema,
  handle: z.string().min(1),
  url: z.string().nullable(),
  followers: z.number().int().nonnegative().nullable(),
  growth: SocialGrowthSchema,
  series: z.array(z.object({ date: z.string().min(1), followers: z.number().int().nonnegative() })),
});

export const SocialDashboardSchema = z.object({
  totalFollowers: z.number().int().nonnegative(),
  asOf: z.string().nullable(),
  platforms: z.array(SocialPlatformStatsSchema),
});

export const SocialPlatformDetailSchema = z.object({
  account: SocialAccountSchema,
  followers: z.number().int().nonnegative().nullable(),
  growth: SocialGrowthSchema,
  snapshots: z.array(SocialSnapshotSchema),
});

// Email-list audience tracked alongside the social platforms. One row per day.
// Seeded from the real Beehiiv account; syncBeehiivEmail appends live snapshots
// once BEEHIIV_API_KEY is set (same shape).
export const EmailListSnapshotSchema = z.object({
  capturedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'capturedAt must look like 2026-06-13'),
  subscribers: z.number().int().nonnegative(),
  source: z.string().min(1),
});

// Per-platform DM counts. Seeded dummy until a ManyChat/Zernio source lands.
export const SocialDmSchema = z.object({
  platform: SocialPlatformSchema,
  count: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
});

// Per-platform DM count history — one row per platform per day, so DM growth
// can be charted over 7/30/60/all windows. Seeded dummy until a real source.
export const SocialDmSnapshotSchema = z.object({
  platform: SocialPlatformSchema,
  capturedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'capturedAt must look like 2026-06-13'),
  count: z.number().int().nonnegative(),
  source: z.string().min(1),
});

// A single DM message in the /social inbox (Instagram-first). Seeded dummy
// until the ManyChat webhook (POST /api/webhooks/manychat) feeds it live —
// ManyChat's API cannot list DMs, so the inbound stream is push, not poll.
export const DmDirectionSchema = z.enum(['in', 'out']); // in = from the subscriber, out = from us
export const SocialDmMessageSchema = z.object({
  id: z.string().min(1),
  platform: SocialPlatformSchema,
  subscriberId: z.string().min(1),
  name: z.string().min(1),
  handle: z.string().nullable(),
  text: z.string(),
  direction: DmDirectionSchema,
  tag: z.string().nullable(),
  ts: z.string().min(1),
  source: z.string().min(1),
});

export const SocialPostStatusSchema = z.enum(['queued', 'published', 'failed']);

// A post composed on the Social tab and queued for the Zernio-publishing agent.
export const SocialPostSchema = z.object({
  id: z.string().min(1),
  caption: z.string().min(1),
  mediaUrl: z.string().nullable(),
  platforms: z.array(SocialPlatformSchema).min(1, 'pick at least one platform'),
  status: SocialPostStatusSchema,
  scheduledFor: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const ContactTagSchema = z.object({
  person: z.string().min(1),
  channel: z.string().min(1), // whatsapp · email · slack · imessage …
  tag: z.string().min(1), // client · student · friend …
  tier: z.number().int().min(1).max(3), // 1 red · 2 yellow · 3 green
});

// ── People + SOP tasks — the humans in the process and the written-out jobs ──
// A person is a human employee on the org graph (distinct from agents). A SOP
// task is one written-out job owned by exactly ONE worker — an agent or a
// person, never both, never shared (the "monogamy" rule; enforced by tests).
export const PersonSchema = z.object({
  id: z.string().min(1),
  departmentId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  tools: z.array(z.string().min(1)).min(1), // same slug namespace agents use
});

export const SopAssigneeKindSchema = z.enum(['agent', 'person']);

export const SopTaskSchema = z.object({
  id: z.string().min(1),
  departmentId: z.string().min(1),
  title: z.string().min(1), // the job, stated as work ("Triage the four inboxes")
  summary: z.string(),
  steps: z.array(z.string().min(1)).min(3), // the written-out SOP checklist
  assigneeKind: SopAssigneeKindSchema,
  assigneeId: z.string().min(1),
});

// ── Workflows — the machine, mapped as a chain of owned process steps ───────
// Each step is owned by a human or an agent, costs weekly hours, may leak money
// (a bottleneck), and may carry a live/suggested automation that recovers it.
export const WorkflowOwnerKindSchema = z.enum(['human', 'agent']);
export const WorkflowAutomationStateSchema = z.enum(['live', 'suggested']);

// A step forks off a named prior step rather than the array's previous
// index — `from` is that prior step's id, `condition` is what's rendered on
// the connector into this branch ("approved", "went quiet", …). Two or more
// steps naming the same `from` fan out as siblings; see
// `workflowStepParent` in app/workflows/tree.ts for how this threads.
export const WorkflowBranchSchema = z.object({
  from: z.string().min(1),
  condition: z.string().min(1),
});

export const WorkflowStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string(), // full step description for the step-detail drawer
  ownerKind: WorkflowOwnerKindSchema,
  owner: z.string().min(1), // "Owner · Founder" / "SDR Agent"
  hoursPerWeek: z.number().nonnegative(),
  tools: z.array(z.string()), // tool slugs (same namespace as agents)
  edgeLabel: z.string().nullable(), // label on the edge INTO the next step
  leakUsd: z.number().nonnegative().nullable(), // $/mo bleeding here when it's a bottleneck
  automation: z
    .object({
      title: z.string().min(1),
      state: WorkflowAutomationStateSchema,
      recoveredUsd: z.number().nonnegative(), // $/mo the automation carries
    })
    .nullable(),
  branch: WorkflowBranchSchema.nullable(),
  // Canvas + sync fields (2026-09-15). All optional so rows written before
  // the canvas existed parse unchanged. `ownerAgentId` is the durable link to
  // the roster (`owner` stays the display name); `kind` is the canvas node
  // type; `config` holds the node's settings, including
  // `bindings: { <fieldKey>: <ruleKey> }` for fields that live in the
  // brand-deal daemon's rules.json rather than in this row; `pos` is the
  // saved canvas position.
  ownerAgentId: z.string().min(1).nullable().optional(),
  kind: z.string().min(1).optional(),
  config: z.record(z.unknown()).optional(),
  pos: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
});

export const WorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1), // "Acme sales machine"
  subtitle: z.string(),
  revenueUsd: z.number().nonnegative(), // $/mo this machine drives (context for leaks)
  order: z.number().int(),
  steps: z.array(WorkflowStepSchema),
  // Target agent-owned share set by dragging the ratio marker on the canvas;
  // null/absent = show the computed ratio.
  ratioTarget: z.number().min(0).max(1).nullable().optional(),
});

// ── Versions — every workflow save and every brand-deal rules write records
// one. Restores append, nothing is deleted. ─────────────────────────────────
export const WorkflowVersionSchema = z.object({
  id: z.string().min(1),
  workflowId: z.string().min(1),
  version: z.number().int().positive(),
  createdAt: z.string().min(1),
  note: z.string(),
  snapshot: z.unknown(), // a Workflow as it was at that version
});
export const ConfigVersionSchema = z.object({
  id: z.string().min(1),
  target: z.string().min(1), // 'bdpilot-rules'
  version: z.number().int().positive(),
  createdAt: z.string().min(1),
  note: z.string(),
  snapshot: z.unknown(),
});

// ── Brand-deal daemon rules — the exact keys ~/.config/bdpilot/rules.json
// carries (mirrors RULE_KEYS in bdpilot.py). Edited from the canvas, applied
// by the daemon on its next cycle. ───────────────────────────────────────────
export const BrandDealRulesSchema = z.object({
  pass_below: z.number().int().min(0).max(100),
  qual_criteria: z.string().min(40),
  draft_rules: z.string().min(80),
  unique_hints: z.array(z.string().min(1)).min(1),
  deal_hints: z.array(z.string().min(1)).min(1),
  audit_every_days: z.number().int().min(1).max(30),
  stale_days: z.number().int().min(1).max(30),
  max_retry_attempts: z.number().int().min(1).max(50),
});


// ── Skills — the agent workforce's capability library ───────────────────────
export const SkillStatusSchema = z.enum(['live', 'learning', 'planned']);
export const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1), // "Sales", "Content", "Ops"…
  description: z.string(),
  ownerAgentId: z.string().nullable(), // the agent that primarily wields it
  status: SkillStatusSchema,
  tools: z.array(z.string()),
  markdown: z.string(), // the skill's SKILL.md doc, viewable from the card
  order: z.number().int(),
});

// ── Client roster — one row per client, whatever the source ─────────────────
// The Clients pillar serves Attio deals when the connector is live and the
// seeded funnel otherwise; `source` keeps the card honest about which.
export const RosterClientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  venture: z.string(),
  status: z.string().min(1),
  amountUsd: z.number().nullable(),
  source: z.enum(['attio', 'funnel']),
});

// ── Funnel — client journeys from first touch to conversion ─────────────────
// Canonical stages; `nurtured` is optional so a journey renders as 4–5 touches.
export const FunnelStageSchema = z.enum(['first_touch', 'engaged', 'nurtured', 'opted_in', 'converted']);
/** Venture id a journey belongs to (see lib/ventures.ts); 'default' when ventures are not configured. */
export const FunnelVentureSchema = z.string().min(1);
export const FunnelChannelSchema = z.enum(['organic', 'ads', 'dm', 'email', 'webinar', 'call', 'checkout', 'crm']);
// Where each touch comes from: Trakyo (organic attribution), Meta Ads MCP
// (paid), Attio (live CRM pipeline), manual otherwise. Seeded rows carry the
// intended source so the live swap is a repo-level change.
export const FunnelSourceSchema = z.enum(['trakyo', 'meta-ads', 'attio', 'ghl', 'manual', 'wordpress']);

// Relationship temperature with the operator — with likelihood-to-buy (0–100) it
// drives how a client node renders in the funnel space. Seeded dummy; later
// computed from CRM (Attio) + Trakyo engagement.
export const FunnelRelationshipSchema = z.enum(['cold', 'warm', 'hot']);

export const FunnelContactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  venture: FunnelVentureSchema,
  status: FunnelStageSchema, // furthest stage reached
  product: z.string().nullable(), // what they opted in to buy, once converted
  amountUsd: z.number().nonnegative().nullable(),
  relationship: FunnelRelationshipSchema,
  likelihood: z.number().int().min(0).max(100),
  /** Deep link to the source record (Attio web_url / GHL contact page). */
  url: z.string().nullable().default(null),
  /** Contact channels for outreach — GHL carries both; Attio joins them from
   * the deal's associated person record (fetchAttioContacts). */
  email: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  /** The human behind the deal — joined from the CRM person/company records
   * so the dossier says WHO this is, not just the deal title. */
  person: z.string().nullable().default(null),
  company: z.string().nullable().default(null),
  role: z.string().nullable().default(null),
  linkedin: z.string().nullable().default(null),
  createdAt: z.string().min(1),
});

export const FunnelTouchSchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
  seq: z.number().int().positive(), // 1..n position in the journey
  stage: FunnelStageSchema,
  channel: FunnelChannelSchema,
  label: z.string().min(1), // e.g. "IG reel: 3 offers that close themselves"
  source: FunnelSourceSchema,
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'at must look like 2026-06-13'),
});

export const FunnelJourneySchema = FunnelContactSchema.extend({
  touches: z.array(FunnelTouchSchema),
});

// One bar of the funnel: journeys that progressed at least this far, split by
// how they entered (first-touch organic vs ads).
export const FunnelStageRowSchema = z.object({
  stage: FunnelStageSchema,
  total: z.number().int().nonnegative(),
  organic: z.number().int().nonnegative(),
  ads: z.number().int().nonnegative(),
  conversionFromPrev: z.number().min(0).max(100).nullable(),
});

export const FunnelSummarySchema = z.object({
  clients: z.number().int().nonnegative(),
  converted: z.number().int().nonnegative(),
  revenueUsd: z.number().nonnegative(),
  stages: z.array(FunnelStageRowSchema),
});

export type Department = z.infer<typeof DepartmentSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type Tool = z.infer<typeof ToolSchema>;
export type RoadmapItem = z.infer<typeof RoadmapItemSchema>;
export type RoadmapStatus = z.infer<typeof RoadmapStatusSchema>;
export type Metric = z.infer<typeof MetricSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type BrainOverview = z.infer<typeof BrainOverviewSchema>;
export type AgentTier = z.infer<typeof AgentTierSchema>;
export type Broadcast = z.infer<typeof BroadcastSchema>;
export type BroadcastReply = z.infer<typeof BroadcastReplySchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;
export type AgentMessageRole = z.infer<typeof AgentMessageRoleSchema>;
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;
export type BrainGraphNode = z.infer<typeof BrainGraphNodeSchema>;
export type BrainGraphEdge = z.infer<typeof BrainGraphEdgeSchema>;
export type BrainGraph = z.infer<typeof BrainGraphSchema>;
export type LifeMapNode = z.infer<typeof LifeMapNodeSchema>;
export type LifeMap = z.infer<typeof LifeMapSchema>;
export type ContactTag = z.infer<typeof ContactTagSchema>;
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>;
export type SocialAccount = z.infer<typeof SocialAccountSchema>;
export type SocialSnapshot = z.infer<typeof SocialSnapshotSchema>;
export type SocialGrowth = z.infer<typeof SocialGrowthSchema>;
export type SocialPlatformStats = z.infer<typeof SocialPlatformStatsSchema>;
export type SocialDashboard = z.infer<typeof SocialDashboardSchema>;
export type SocialPlatformDetail = z.infer<typeof SocialPlatformDetailSchema>;
export type EmailListSnapshot = z.infer<typeof EmailListSnapshotSchema>;
export type SocialDm = z.infer<typeof SocialDmSchema>;
export type SocialDmSnapshot = z.infer<typeof SocialDmSnapshotSchema>;
export type SocialDmMessage = z.infer<typeof SocialDmMessageSchema>;
export type DmDirection = z.infer<typeof DmDirectionSchema>;
export type SocialPostStatus = z.infer<typeof SocialPostStatusSchema>;
export type SocialPost = z.infer<typeof SocialPostSchema>;
export type AgentTask = z.infer<typeof AgentTaskSchema>;
/** What a caller must supply to create one: the new fields all have defaults,
 *  so seeds and API routes keep passing the four they actually know. */
export type AgentTaskInput = z.input<typeof AgentTaskSchema>;
export type AgentCron = z.infer<typeof AgentCronSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type SopAssigneeKind = z.infer<typeof SopAssigneeKindSchema>;
export type SopTask = z.infer<typeof SopTaskSchema>;
export type RosterClient = z.infer<typeof RosterClientSchema>;
export type FunnelStage = z.infer<typeof FunnelStageSchema>;
export type FunnelRelationship = z.infer<typeof FunnelRelationshipSchema>;
export type FunnelVenture = z.infer<typeof FunnelVentureSchema>;
export type FunnelChannel = z.infer<typeof FunnelChannelSchema>;
export type FunnelSource = z.infer<typeof FunnelSourceSchema>;
export type FunnelContact = z.infer<typeof FunnelContactSchema>;
export type FunnelTouch = z.infer<typeof FunnelTouchSchema>;
export type FunnelJourney = z.infer<typeof FunnelJourneySchema>;
export type FunnelStageRow = z.infer<typeof FunnelStageRowSchema>;
export type FunnelSummary = z.infer<typeof FunnelSummarySchema>;
export type WorkflowOwnerKind = z.infer<typeof WorkflowOwnerKindSchema>;
export type WorkflowAutomationState = z.infer<typeof WorkflowAutomationStateSchema>;
export type WorkflowBranch = z.infer<typeof WorkflowBranchSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;
export type ConfigVersion = z.infer<typeof ConfigVersionSchema>;
export type BrandDealRules = z.infer<typeof BrandDealRulesSchema>;
export type SkillStatus = z.infer<typeof SkillStatusSchema>;
export type Skill = z.infer<typeof SkillSchema>;

/* ── Content Lab (docs/projects/content-lab/SPEC.md §4.5, §6; CONTRACT.md) ──────────
   Row shapes for the lab_* tables (camelCase; lib/lab/store.ts maps the snake_case
   columns). Enums carry `other` where the analysis schema says so. */

export const LAB_PLATFORMS = ['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter'] as const;
export const LabPlatformSchema = z.enum(LAB_PLATFORMS);
export const LAB_FEEDS = ['hn', 'reddit', 'producthunt', 'google_trends', 'changelog', 'keyword_search'] as const;
export const LabFeedSchema = z.enum(LAB_FEEDS);
/** v2 (08): `watch` = an X watch-list account (platform 'x', 05 3.7). */
export const LabSourceKindSchema = z.enum(['owned', 'tracked', 'suggested', 'feed', 'watch']);
export const LabSourceStatusSchema = z.enum(['active', 'paused', 'dismissed']);

export const LAB_FORMATS = ['talking_head', 'screen_recording', 'tutorial_walkthrough', 'b_roll_voiceover', 'green_screen', 'skit', 'interview_clip', 'carousel', 'text_post', 'long_form', 'other'] as const;
export const LabFormatSchema = z.enum(LAB_FORMATS);
export const LAB_HOOK_FORMS = ['contrarian', 'results_first', 'open_loop', 'direct_challenge', 'pattern_interrupt', 'howto_promise', 'news_react', 'social_proof_claim', 'identity_call', 'confession', 'list_tease', 'direct_question', 'mid_action', 'number_stat', 'imperative', 'direct_address', 'time_saving', 'problem_question', 'quote', 'other'] as const;
export const LabHookFormSchema = z.enum(LAB_HOOK_FORMS);
export const LAB_TRIGGERS = ['curiosity', 'fear_fomo', 'loss_aversion', 'aspiration', 'frustration', 'authority_status', 'surprise_shock', 'controversy', 'urgency', 'relatability', 'other'] as const;
export const LabTriggerSchema = z.enum(LAB_TRIGGERS);
export const LabHookChannelSchema = z.enum(['spoken', 'on_screen_text', 'visual', 'audio', 'mixed']);
export const LAB_STRUCTURES = ['problem_solution', 'tutorial', 'listicle', 'story_lesson', 'hot_take', 'comparison', 'news_breakdown', 'demo_reveal', 'myth_bust', 'other'] as const;
export const LabStructureSchema = z.enum(LAB_STRUCTURES);
export const LAB_BEAT_TYPES = ['hook', 'context', 'promise', 'demo', 'claim', 'evidence', 'contrast', 'reveal', 'payoff', 'rehook', 'cta', 'other'] as const;
export const LabBeatTypeSchema = z.enum(LAB_BEAT_TYPES);
export const LabPacingSchema = z.enum(['rapid_fire', 'conversational', 'slow_build', 'punchy']);
export const LabPillarSchema = z.enum(['educational', 'entertainment', 'inspirational', 'promotional', 'community', 'behind_scenes']);
export const LabCtaTypeSchema = z.enum(['follow', 'comment_keyword', 'link', 'product', 'none', 'other']);
export const LabTrajectorySchema = z.enum(['fast_flat', 'slow_sustained', 'consistent']);
export const LabQuadrantSchema = z.enum(['ideal', 'loyal', 'clickbait', 'dud']);
export const LabConfidenceSchema = z.enum(['low', 'ok', 'high']);
export const LabTimingSchema = z.enum(['early', 'open', 'closing', 'closed']);
/** Exactly the 21 run kinds of 08.6.3 item 5 (v1, 04, 05, 06, 07, 08). Nothing else is valid. */
export const LAB_RUN_KINDS = [
  'scrape', 'profile', 'search', 'transcribe', 'dissect', 'distill', 'ideas', 'script',
  'snapshot', 'verify',
  'radar', 'brief',
  'retention', 'grade', 'backtest', 'oauth_refresh',
  'judge', 'comments', 'frames', 'embed',
  'health',
] as const;
export const LabRunKindSchema = z.enum(LAB_RUN_KINDS);
/** `blocked` = stopped by the monthly cap before anything was sent (asks on next visit). */
export const LabRunStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'aborted', 'timed_out', 'blocked']);
/** v2 providers (08.6.1); v1 name kept, values extended. */
export const LAB_SPEND_PROVIDERS = ['apify', 'stt', 'comments', 'downloads', 'embed', 'llm'] as const;
export const LabSpendProviderSchema = z.enum(LAB_SPEND_PROVIDERS);
export const LabTranscriptStatusSchema = z.enum(['none', 'pending', 'done', 'failed']);
export const LabIdeaStatusSchema = z.enum(['open', 'used', 'dismissed']);
export const LabScriptStatusSchema = z.enum(['draft', 'published']);

/* ── Content Lab v2 (S0): names the v1 row schemas below now reference ──────────────
   docs/projects/content-lab/v2/SPEC.md 3.4, 3.8; owners named per line. */
/** 05 12.1. The one angle vocabulary (`how_to`, never `howto`). lib/lab/radar/angles.ts re-exports it. */
export const LAUNCH_ANGLES = ['first_look', 'real_examples', 'hours_spent', 'comparison', 'how_to', 'money', 'drama', 'other'] as const;
export const LaunchAngleSchema = z.enum(LAUNCH_ANGLES);
/** 04 3.10 */
export const EXO_REASONS = ['collab', 'newsletter', 'paid_boost', 'big_account_share', 'other'] as const;
export const LabExoReasonSchema = z.enum(EXO_REASONS);
/** 04 8: how a metric row was read. */
export const LAB_READ_KINDS = ['cycle', 'snapshot', 'dense', 'discover', 'manual'] as const;
export const LabReadKindSchema = z.enum(LAB_READ_KINDS);
/** 04 3.8: YouTube Shorts counted views differently before 2025-03-31. */
export const LabEpochSchema = z.enum(['current', 'yt_shorts_pre_2025_03_31']);
/** 07 7.5 */
export const LabGroundingRefSchema = z.object({ postId: z.string(), creatorId: z.string(), ratio: z.number(), hookText: z.string(), angle: z.string(), ageH: z.number() });
export const LabGroundingSchema = z.object({
  exemplars: z.array(LabGroundingRefSchema),
  duds: z.array(LabGroundingRefSchema),
  contrast: z.string(),
  query: z.string(),
  embedModel: z.string(),
  thin: z.boolean(),
});
export type LabGroundingRef = z.infer<typeof LabGroundingRefSchema>;
export type LabGrounding = z.infer<typeof LabGroundingSchema>;
export const emptyGrounding: LabGrounding = { exemplars: [], duds: [], contrast: '', query: '', embedModel: 'local-hash-v1', thin: true };
/** 07 7.6 */
export const LabRuleIdSchema = z.enum([
  'hook-concreteness', 'hook-referent', 'loops-closed', 'promise-by-80', 'late-peak',
  'end-on-payoff', 'one-cta', 'originality', 'risk-linkedin-bait', 'risk-x-hostility', 'risk-outgroup',
]);
export const LabRuleResultSchema = z.object({
  id: LabRuleIdSchema,
  severity: z.enum(['block', 'warn', 'info']),
  ok: z.boolean(),
  label: z.string(),
  detail: z.string(),
  section: z.number().int().nullable(),
  value: z.number().nullable().default(null),
  source: z.string(),
});
/** 07 7.3.6: where an idea came from. */
export const LabIdeaSourceSchema = z.enum(['sync', 'generate', 'event', 'seed', 'manual']);
/** 08.6.1: a line is one kind of work inside a provider; every gated call names both. */
export const LAB_SPEND_LINES = [
  'apify.sync', 'apify.snapshots', 'apify.x', 'apify.verify',
  'apify.radar_x', 'apify.radar_tiktok', 'apify.radar_producthunt',
  'stt', 'stt.controls',
  'comments', 'downloads', 'embed', 'llm',
] as const;
export const LabSpendLineSchema = z.enum(LAB_SPEND_LINES);
/** 09.4.3: lab_runs.progress_json, written by advance for a non-terminal run. */
export const LabRunProgressSchema = z.object({
  items: z.number().nullable(),
  usd: z.number().nullable(),
  statusMessage: z.string().nullable(),
  polledAt: z.string().nullable(),
  backoffUntil: z.string().nullable().optional(),
  events: z.record(z.number()).nullable().optional(),
});
/* ── end Content Lab v2 early block ── */

/** Percentages 0-100 of the runtime, so beats compare across durations. */
export const LabBeatSchema = z.object({
  startPct: z.number().min(0).max(100),
  endPct: z.number().min(0).max(100),
  type: LabBeatTypeSchema,
  summary: z.string().default(''),
});
export const LabTensionSchema = z.object({ falseBelief: z.string(), reframe: z.string() });

export const LabSourceSchema = z.object({
  id: z.string().min(1),
  kind: LabSourceKindSchema,
  /** A social platform, or a feed id for kind `feed`; `x` only on kind `watch` (v2, 08). */
  platform: z.union([LabPlatformSchema, LabFeedSchema, z.literal('x')]),
  handle: z.string(),
  url: z.string().nullable(),
  displayName: z.string(),
  status: LabSourceStatusSchema,
  addedAt: z.string(),
  /** Why discovery suggested it ("8 of 10 sampled posts are AI tool tutorials, 3 broke out"). */
  reason: z.string().nullable(),
  /** Discovery score 0-1 (suggestions only). */
  score: z.number().nullable(),
});
export const LabCreatorSnapshotSchema = z.object({
  sourceId: z.string(),
  capturedAt: z.string(),
  followers: z.number().nullable(),
  following: z.number().nullable(),
  postCount: z.number().nullable(),
});
export const LabPostSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string(),
  platform: LabPlatformSchema,
  externalId: z.string(),
  url: z.string(),
  postedAt: z.string().nullable(),
  caption: z.string(),
  contentType: z.string(),
  thumbnailUrl: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  durationS: z.number().nullable(),
  isOwned: z.boolean(),
  /* v2 (04, LAB_V2_COLUMNS). Optional so v1 writers keep compiling; the store always fills them on read. */
  epoch: LabEpochSchema.optional(),
  exoReason: LabExoReasonSchema.nullable().optional(),
  exoNote: z.string().nullable().optional(),
  exoAt: z.string().nullable().optional(),
});
/** One read of a post's counters. Never overwritten; null = the platform did not return it. */
export const LabPostMetricsSchema = z.object({
  postId: z.string(),
  capturedAt: z.string(),
  views: z.number().nullable(),
  likes: z.number().nullable(),
  comments: z.number().nullable(),
  shares: z.number().nullable(),
  saves: z.number().nullable(),
  /* v2 (04 8). Optional on write; the store fills them on read (readKind 'cycle', others null). */
  ageH: z.number().nullable().optional(),
  targetAgeH: z.number().nullable().optional(),
  readKind: LabReadKindSchema.optional(),
  quotes: z.number().nullable().optional(),
});
export const LabTranscriptSchema = z.object({
  postId: z.string(),
  text: z.string(),
  wordCount: z.number().int(),
  wpm: z.number().nullable(),
  provider: z.string(),
  costUsd: z.number(),
  status: LabTranscriptStatusSchema,
});
export const LabDissectionSchema = z.object({
  postId: z.string(),
  format: LabFormatSchema,
  hookForm: LabHookFormSchema,
  emotionalTrigger: LabTriggerSchema,
  hookChannel: LabHookChannelSchema,
  hookText: z.string(),
  firstFrameText: z.string(),
  structureType: LabStructureSchema,
  beats: z.array(LabBeatSchema),
  pacing: LabPacingSchema,
  pillar: LabPillarSchema,
  ctaType: LabCtaTypeSchema,
  tension: LabTensionSchema.nullable(),
  confidences: z.record(z.number().min(0).max(1)),
  qualityNotes: z.string(),
  modelId: z.string(),
  promptVersion: z.string(),
  analysedAt: z.string(),
  /* v2 (07 7.14.4). Optional on write; the store fills them on read. */
  framesUsed: z.number().int().optional(),
  onScreenTextDensity: z.number().int().min(0).max(3).nullable().optional(),
  faceFirstFrame: z.boolean().nullable().optional(),
  sheetPath: z.string().nullable().optional(),
});
export const LabPostTopicSchema = z.object({
  postId: z.string(),
  topic: z.string(),
  angle: z.string(),
  isPrimary: z.boolean(),
  clusterId: z.string().nullable(),
});
export const LabMeasureSchema = z.object({
  postId: z.string(),
  depth: z.number().nullable(),
  breakout: z.number().nullable(),
  breakoutLo: z.number().nullable(),
  breakoutHi: z.number().nullable(),
  baselineN: z.number().int(),
  baselineConfidence: LabConfidenceSchema,
  reach: z.number().nullable(),
  velocity: z.number().nullable(),
  trajectory: LabTrajectorySchema.nullable(),
  quadrant: LabQuadrantSchema.nullable(),
  isBreakout: z.boolean(),
  computedAt: z.string(),
});
export const LabClusterSchema = z.object({ id: z.string(), label: z.string(), createdAt: z.string() });
export const LabTrendSnapshotSchema = z.object({
  clusterId: z.string(),
  day: z.string(),
  posts: z.number().int(),
  breakouts: z.number().int(),
  creators: z.number().int(),
  platforms: z.number().int(),
  feedMentions: z.number().int(),
  sourceCount: z.number().int(),
  momentum: z.number().nullable(),
  timing: LabTimingSchema.nullable(),
});
export const LabTrendItemSchema = z.object({
  id: z.string(),
  feed: LabFeedSchema,
  url: z.string(),
  title: z.string(),
  score: z.number().nullable(),
  comments: z.number().nullable(),
  sources: z.array(z.string()),
  sourceCount: z.number().int(),
  clusterId: z.string().nullable(),
  seenAt: z.string(),
  actedOnAt: z.string().nullable(),
});
/** One feature value's lift over the format's base breakout rate (§4.7). */
export const LabFeatureLiftSchema = z.object({
  feature: z.string(),
  value: z.string(),
  /** posts with this value in the window */
  total: z.number().int(),
  /** breakouts with this value */
  n: z.number().int(),
  lift: z.number().nullable(),
  lo: z.number().nullable(),
  hi: z.number().nullable(),
  /** n >= 8 breakouts and the interval excludes 1.0 */
  shown: z.boolean(),
  /* v2 (04 5.5), all optional so v1 rows parse. lift/lo/hi hold the OR once case-control is live. */
  or: z.number().nullable().optional(),
  orLo: z.number().nullable().optional(),
  orHi: z.number().nullable().optional(),
  p: z.number().nullable().optional(),
  q: z.number().nullable().optional(),
  casesWith: z.number().int().nullable().optional(),
  controlsWith: z.number().int().nullable().optional(),
  liftW: z.number().nullable().optional(),
  method: z.literal('mh').nullable().optional(),
});
export const LabProfileSchema = z.object({
  id: z.string(),
  formatFamily: z.string(),
  label: z.string(),
  version: z.number().int(),
  windowDays: z.number().int(),
  postsN: z.number().int(),
  breakoutsN: z.number().int(),
  features: z.array(LabFeatureLiftSchema),
  strand: z.array(LabBeatSchema),
  /** Measured bands for the format's breakouts: wpm [lo, hi], duration [lo, hi] seconds. */
  stats: z.object({ wpm: z.tuple([z.number(), z.number()]).nullable(), durationS: z.tuple([z.number(), z.number()]).nullable() }),
  createdAt: z.string(),
  /* v2 (04 8). Optional on write; the store fills them on read. */
  method: z.string().optional(),
  controlsN: z.number().int().optional(),
  fdrQ: z.number().nullable().optional(),
});
export const LabHookRecSchema = z.object({ form: LabHookFormSchema, trigger: LabTriggerSchema, lift: z.number().nullable(), n: z.number().int() });
export const LabEvidenceRefSchema = z.object({ postId: z.string(), why: z.string() });
export const LabIdeaSchema = z.object({
  id: z.string(),
  title: z.string(),
  clusterId: z.string().nullable(),
  angle: z.string(),
  tension: LabTensionSchema.nullable(),
  formatFamily: z.string(),
  strand: z.array(LabBeatSchema),
  hookRecs: z.array(LabHookRecSchema),
  evidence: z.array(LabEvidenceRefSchema),
  timing: LabTimingSchema.nullable(),
  fit: z.number().min(0).max(1),
  thin: z.boolean(),
  status: LabIdeaStatusSchema,
  dismissReason: z.string().nullable(),
  createdAt: z.string(),
  actedOnAt: z.string().nullable(),
  /* v2 (05: eventId, launchAngle; 07 7.3.6: the rest). Optional so v1 rows and writers work; the store fills them on read. */
  eventId: z.string().nullable().optional(),
  launchAngle: LaunchAngleSchema.nullable().optional(),
  source: LabIdeaSourceSchema.optional(),
  batchId: z.string().nullable().optional(),
  seedId: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  hookForm: LabHookFormSchema.nullable().optional(),
  hookTrigger: LabTriggerSchema.nullable().optional(),
  vsProbability: z.number().min(0).max(1).nullable().optional(),
  mmrRank: z.number().int().nullable().optional(),
  grounding: LabGroundingSchema.optional(),
  promptVersion: z.string().nullable().optional(),
});
export const LabScriptSchema = z.object({
  id: z.string(),
  ideaId: z.string().nullable(),
  title: z.string(),
  status: LabScriptStatusSchema,
  publishedPostId: z.string().nullable(),
  createdAt: z.string(),
});
export const LabScriptHookSchema = z.object({ form: LabHookFormSchema, trigger: LabTriggerSchema, spoken: z.string(), onScreen: z.string(), words: z.number().int() });
export const LabScriptSectionSchema = z.object({
  type: LabBeatTypeSchema,
  startPct: z.number(),
  endPct: z.number(),
  spoken: z.string(),
  onScreen: z.string(),
  visualNote: z.string(),
});
export const LabScriptBodySchema = z.object({
  durationS: z.number(),
  wpm: z.number(),
  hooks: z.array(LabScriptHookSchema),
  /** index into hooks of the chosen one */
  hookChoice: z.number().int().default(0),
  sections: z.array(LabScriptSectionSchema),
  cta: z.string(),
  caption: z.string(),
  titles: z.array(z.string()),
  /* v2 (07 7.6), JSON only. Optional (not defaulted) so v1 writers keep compiling; readers treat
     absent as: platform 'multi', loops [], withheld '', peakSection null, endType null,
     grounding emptyGrounding, arm 'grounded', armP null (07's spec defaults). */
  platform: z.union([LabPlatformSchema, z.literal('multi')]).optional(),
  loops: z.array(z.object({ id: z.string(), question: z.string(), answer: z.string(), opens: z.number().int(), closes: z.number().int().nullable() })).optional(),
  withheld: z.string().optional(),
  peakSection: z.number().int().nullable().optional(),
  endType: z.enum(['payoff', 'callback', 'cta', 'fade']).nullable().optional(),
  grounding: LabGroundingSchema.optional(),
  arm: z.enum(['grounded', 'control']).optional(),
  armP: z.number().min(0).max(1).nullable().optional(),
});
export const LabGateCheckSchema = z.object({ id: z.string(), label: z.string(), ok: z.boolean(), detail: z.string(), section: z.number().int().nullable() });
export const LabGateSchema = z.object({
  passed: z.boolean(),
  checks: z.array(LabGateCheckSchema),
  /** The cheap model check (1-5 each), null until it ran. */
  scores: z.object({ voice: z.number(), tension: z.number(), evidence: z.number(), register: z.number() }).nullable(),
  /* v2 (07 7.6): passed = v1 checks all ok AND every block rule ok. Optional so v1 gates parse
     and v1 writers compile; absent = rules [] and rulesVersion null. */
  rules: z.array(LabRuleResultSchema).optional(),
  rulesVersion: z.string().nullable().optional(),
});
export const LabScriptVersionSchema = z.object({
  scriptId: z.string(),
  version: z.number().int(),
  body: LabScriptBodySchema,
  gate: LabGateSchema,
  createdAt: z.string(),
  editDiff: z.string().nullable(),
});
export const LabOutcomeSchema = z.object({ scriptId: z.string(), postId: z.string(), capturedAt: z.string(), breakout: z.number().nullable(), depth: z.number().nullable() });
export const LabPriorSchema = z.object({ key: z.string(), value: z.unknown(), n: z.number().int(), supersedesDefault: z.boolean(), updatedAt: z.string() });
export const LabRunSchema = z.object({
  id: z.string(),
  kind: LabRunKindSchema,
  apifyRunId: z.string().nullable(),
  datasetId: z.string().nullable(),
  actor: z.string().nullable(),
  input: z.unknown(),
  status: LabRunStatusSchema,
  items: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  dry: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
  /* v2 (08.6.4, 09.6). Optional on write; the store fills them on read. */
  line: LabSpendLineSchema.nullable().optional(),
  job: z.string().nullable().optional(),
  scheduled: z.boolean().optional(),
  batchId: z.string().nullable().optional(),
  progress: LabRunProgressSchema.nullable().optional(),
});
export const LabSpendSchema = z.object({
  id: z.number().int().optional(),
  runId: z.string().nullable(),
  provider: LabSpendProviderSchema,
  units: z.number(),
  estUsd: z.number().nullable(),
  /** From the finished run (Apify usageTotalUsd); null until settled. */
  actualUsd: z.number().nullable(),
  dry: z.boolean(),
  at: z.string(),
  /* v2 (08.6.4). Optional on write; the store fills them on read. */
  line: LabSpendLineSchema.optional(),
  reservedUsd: z.number().nullable().optional(),
  actualSource: z.enum(['provider', 'published_price', 'dry']).nullable().optional(),
  events: z.record(z.number()).nullable().optional(),
  settledAt: z.string().nullable().optional(),
});

export type LabPlatform = z.infer<typeof LabPlatformSchema>;
export type LabFeed = z.infer<typeof LabFeedSchema>;
export type LabSourceKind = z.infer<typeof LabSourceKindSchema>;
export type LabSourceStatus = z.infer<typeof LabSourceStatusSchema>;
export type LabFormat = z.infer<typeof LabFormatSchema>;
export type LabHookForm = z.infer<typeof LabHookFormSchema>;
export type LabTrigger = z.infer<typeof LabTriggerSchema>;
export type LabHookChannel = z.infer<typeof LabHookChannelSchema>;
export type LabStructure = z.infer<typeof LabStructureSchema>;
export type LabBeatType = z.infer<typeof LabBeatTypeSchema>;
export type LabPacing = z.infer<typeof LabPacingSchema>;
export type LabPillar = z.infer<typeof LabPillarSchema>;
export type LabCtaType = z.infer<typeof LabCtaTypeSchema>;
export type LabTrajectory = z.infer<typeof LabTrajectorySchema>;
export type LabQuadrant = z.infer<typeof LabQuadrantSchema>;
export type LabConfidence = z.infer<typeof LabConfidenceSchema>;
export type LabTiming = z.infer<typeof LabTimingSchema>;
export type LabRunKind = z.infer<typeof LabRunKindSchema>;
export type LabRunStatus = z.infer<typeof LabRunStatusSchema>;
export type LabSpendProvider = z.infer<typeof LabSpendProviderSchema>;
export type LabTranscriptStatus = z.infer<typeof LabTranscriptStatusSchema>;
export type LabIdeaStatus = z.infer<typeof LabIdeaStatusSchema>;
export type LabBeat = z.infer<typeof LabBeatSchema>;
export type LabTension = z.infer<typeof LabTensionSchema>;
export type LabSource = z.infer<typeof LabSourceSchema>;
export type LabCreatorSnapshot = z.infer<typeof LabCreatorSnapshotSchema>;
export type LabPost = z.infer<typeof LabPostSchema>;
export type LabPostMetrics = z.infer<typeof LabPostMetricsSchema>;
export type LabTranscript = z.infer<typeof LabTranscriptSchema>;
export type LabDissection = z.infer<typeof LabDissectionSchema>;
export type LabPostTopic = z.infer<typeof LabPostTopicSchema>;
export type LabMeasure = z.infer<typeof LabMeasureSchema>;
export type LabCluster = z.infer<typeof LabClusterSchema>;
export type LabTrendSnapshot = z.infer<typeof LabTrendSnapshotSchema>;
export type LabTrendItem = z.infer<typeof LabTrendItemSchema>;
export type LabFeatureLift = z.infer<typeof LabFeatureLiftSchema>;
export type LabProfile = z.infer<typeof LabProfileSchema>;
export type LabHookRec = z.infer<typeof LabHookRecSchema>;
export type LabEvidenceRef = z.infer<typeof LabEvidenceRefSchema>;
export type LabIdea = z.infer<typeof LabIdeaSchema>;
export type LabScript = z.infer<typeof LabScriptSchema>;
export type LabScriptHook = z.infer<typeof LabScriptHookSchema>;
export type LabScriptSection = z.infer<typeof LabScriptSectionSchema>;
export type LabScriptBody = z.infer<typeof LabScriptBodySchema>;
export type LabGateCheck = z.infer<typeof LabGateCheckSchema>;
export type LabGate = z.infer<typeof LabGateSchema>;
export type LabScriptVersion = z.infer<typeof LabScriptVersionSchema>;
export type LabOutcome = z.infer<typeof LabOutcomeSchema>;
export type LabPrior = z.infer<typeof LabPriorSchema>;
export type LabRun = z.infer<typeof LabRunSchema>;
export type LabSpend = z.infer<typeof LabSpendSchema>;
/* ── end Content Lab schemas ── */

/* ── Content Lab v2 (S0 block; docs/projects/content-lab/v2/SPEC.md 3.4 and 3.8) ──────────
   Every new zod schema the v2 sections name, in one place. Owner section per group. Other
   lanes add to this block only in a marked sub-block at its end. Row schemas mirror the
   tables in lib/db.ts LAB_DDL (camelCase; lib/lab/store.ts maps the columns). */

/* 08: spend, runs, jobs, fixtures */
export type LabSpendLine = z.infer<typeof LabSpendLineSchema>;
export type LabRunProgress = z.infer<typeof LabRunProgressSchema>;
export type LabActualSource = 'provider' | 'published_price' | 'dry';
/** The provider a line bills to: the text before the first '.', else the line itself (08.6.1). */
export function providerOf(line: LabSpendLine): LabSpendProvider {
  return LabSpendProviderSchema.parse(line.split('.')[0]);
}
/** 08.5.1: the only scheduler's job ids, in tick order. */
export const LAB_JOB_IDS = [
  'advance', 'measure.verdicts', 'health',
  'radar.vendor', 'radar.hn', 'radar.hf_models', 'radar.hf_spaces', 'radar.github',
  'radar.x', 'radar.producthunt', 'radar.tiktok_cc', 'radar.wikipedia', 'radar.events', 'brief',
  'snapshots', 'ledger.early', 'sync', 'analyse', 'gen.embed', 'gen.frames', 'gen.comments',
  'intel', 'discover', 'ledger',
] as const;
export const LabJobIdSchema = z.enum(LAB_JOB_IDS);
/** lab_priors `job:<id>` (08.5.1). */
export const LabJobStateSchema = z.object({
  lastAt: z.string().nullable(),
  lastOkAt: z.string().nullable(),
  lastDetail: z.string(),
  fails: z.number().int(),
  skippedReason: z.string().nullable(),
});
/** 08.7.2 */
export const LAB_FIXTURE_SCENARIOS = ['full', 'thin', 'fresh', 'quiet', 'blocked', 'running', 'degraded'] as const;
export const LabFixtureScenarioSchema = z.enum(LAB_FIXTURE_SCENARIOS);

/* 04: measures, controls */
export const LabTrajectoryClassSchema = z.enum(['burst', 'critical', 'slow']);
export const LabMetricBasisSchema = z.enum(['views', 'x_action', 'li_reactions']);
export const LabVolatilityClassSchema = z.enum(['steady', 'normal', 'swingy']);
export const LabBaselineSourceSchema = z.enum(['matched', 'projected']);
export const LabFollowersAsOfSchema = z.enum(['before', 'backfill']);
/** One entry of lab_measures.ages_json, keyed by age in hours (04 8). */
export const LabAgeReadSchema = z.object({
  y: z.number().nullable(),
  ratio: z.number().nullable(),
  lo: z.number().nullable(),
  hi: z.number().nullable(),
  z: z.number().nullable(),
  n: z.number().int(),
  how: z.string(),
});
export const LabMeasureV2Schema = LabMeasureSchema.extend({
  measureVersion: z.string(),
  metricBasis: LabMetricBasisSchema,
  judgedAgeH: z.number().nullable(),
  basisAtAge: z.number().nullable(),
  baselineLog: z.number().nullable(),
  baselineVar: z.number().nullable(),
  priorLog: z.number().nullable(),
  shrinkB: z.number().nullable(),
  baselineSource: LabBaselineSourceSchema.nullable(),
  robustZ: z.number().nullable(),
  volatility: z.number().nullable(),
  volatilityClass: LabVolatilityClassSchema.nullable(),
  maxOverMedian: z.number().nullable(),
  nicheRatio: z.number().nullable(),
  dualHigh: z.boolean(),
  trajectoryClass: LabTrajectoryClassSchema.nullable(),
  peakDayShare: z.number().nullable(),
  exoAuto: z.boolean(),
  sharesPerView: z.number().nullable(),
  savesPerView: z.number().nullable(),
  xActionScore: z.number().nullable(),
  followersAsOf: LabFollowersAsOfSchema.nullable(),
  ages: z.record(LabAgeReadSchema),
});
export const LabControlRoleSchema = z.enum(['case', 'control']);
export const LabControlStatusSchema = z.enum(['selected', 'transcribed', 'dissected', 'caption_only', 'failed']);
export const LabControlSchema = z.object({
  postId: z.string(),
  role: LabControlRoleSchema,
  /** '<source_id>|<yyyy-mm>' */
  stratum: z.string(),
  samplingProb: z.number().min(0).max(1),
  eligibleN: z.number().int(),
  drawnN: z.number().int(),
  seed: z.string(),
  verdictAgeH: z.number(),
  verdictRatio: z.number().nullable(),
  drawnAt: z.string(),
  status: LabControlStatusSchema,
  measureVersion: z.string(),
});

/* 05: Radar (05 section 16) */
export const LAB_RADAR_SOURCES = ['hn', 'hf_models', 'hf_spaces', 'github', 'vendor', 'x', 'producthunt', 'tiktok_cc', 'wikipedia'] as const;
export const LabRadarSourceSchema = z.enum(LAB_RADAR_SOURCES);
export const LabRadarFamilySchema = z.enum(['hn', 'hf', 'github', 'vendor', 'x', 'producthunt', 'tiktok']);
export const LabEventStatusSchema = z.enum(['candidate', 'confirmed', 'expired', 'dismissed', 'merged']);
export const LabNoveltySchema = z.enum(['new_category', 'new_flagship', 'new_surface', 'point_release', 'ecosystem']);
export const LabEventClassSchema = z.enum(['spike', 'adopted', 'unknown']);
export const LabWindowStateSchema = z.enum(['open', 'closing', 'closed']);
export const LabWavePositionSchema = z.enum(['pre', 'first', 'follow']);
export const LabMorningBriefKindSchema = z.enum(['my_post_spike', 'new_launch', 'creator_breakout', 'window_reopened', 'window_closing']);
export const LabEventSchema = z.object({
  id: z.string(), key: z.string(), name: z.string(), vendor: z.string().nullable(), aliases: z.array(z.string()),
  status: LabEventStatusSchema, mergedInto: z.string().nullable(), dismissReason: z.string().nullable(),
  novelty: LabNoveltySchema.nullable(), noveltySource: z.enum(['rule', 'llm', 'manual']).nullable(),
  class: LabEventClassSchema, classBasis: z.enum(['wikipedia', 'hn']).nullable(),
  classInfo: z.object({ peak: z.number().nullable(), preMedian: z.number().nullable(), baselineShare: z.number().nullable(), day7Share: z.number().nullable(), decidedAt: z.string().nullable(), week5Share: z.number().nullable(), classCorrect: z.boolean().nullable() }),
  wikiArticle: z.string().nullable(), attention: z.array(z.object({ day: z.string(), v: z.number() })),
  t0: z.string().nullable(), t0Rule: z.enum(['vendor', 'two_sources', 'manual']).nullable(), t0PingId: z.string().nullable(), t0RevisedAt: z.string().nullable(),
  confirmedAt: z.string().nullable(), firstSeenAt: z.string(), sourceCount: z.number().int(), sources: z.array(LabRadarFamilySchema),
  waveN: z.number().int(), waveStartedAt: z.string().nullable(),
  windowState: LabWindowStateSchema.nullable(), windowOpensAt: z.string().nullable(), windowClosingAt: z.string().nullable(), windowClosesAt: z.string().nullable(),
  windowChangedAt: z.string().nullable(), windowReason: z.string().nullable(),
  windowLog: z.array(z.object({ at: z.string(), from: LabWindowStateSchema.nullable(), to: LabWindowStateSchema, reason: z.string() })),
  clusterId: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
});
export const LabEventPingSchema = z.object({
  id: z.string(), source: LabRadarSourceSchema, family: LabRadarFamilySchema, externalId: z.string(), eventId: z.string().nullable(),
  matchRule: z.enum(['key', 'url', 'repo', 'contain', 'manual']).nullable(), name: z.string().nullable(), nameKey: z.string().nullable(),
  title: z.string(), url: z.string(), author: z.string().nullable(), vendor: z.string().nullable(), sourceTime: z.string().nullable(),
  firstSeenAt: z.string(), lastSeenAt: z.string(), prevSeenAt: z.string().nullable(),
  metricFirst: z.number().nullable(), metricPrev: z.number().nullable(), metricLast: z.number().nullable(), rank: z.number().int().nullable(),
  velocityPerH: z.number().nullable(), robustZ: z.number().nullable(),
  isLaunch: z.boolean(), isBaseline: z.boolean(), qualifies: z.boolean(), qualifyReason: z.string().nullable(),
  fakeStar: z.boolean().nullable(), fakeStarInfo: z.unknown().nullable(), lexicon: z.boolean(), dry: z.boolean(),
});
export const LabEventCoverageSchema = z.object({
  eventId: z.string(), postId: z.string(), sourceId: z.string(), platform: LabPlatformSchema, isOwned: z.boolean(), postedAt: z.string(),
  hoursSinceT0: z.number(), waveN: z.number().int(), wavePosition: LabWavePositionSchema, creatorRank: z.number().int().nullable(),
  matchRule: z.enum(['name', 'family_version', 'cluster', 'manual']), confidence: z.enum(['high', 'low']), confirmed: z.boolean().nullable(),
  angle: LaunchAngleSchema, angleSource: z.enum(['rule', 'llm', 'manual']), ratio: z.number().nullable(), ratioAgeH: z.number().nullable(),
  isBreakout: z.boolean(), computedAt: z.string(),
});
export const LabMorningBriefItemSchema = z.object({ kind: LabMorningBriefKindSchema, dedupeKey: z.string(), priority: z.number().int(), at: z.string(), line: z.string(), href: z.string(), eventId: z.string().nullable(), postId: z.string().nullable() });
export const LabMorningBriefSchema = z.object({ id: z.string(), day: z.string(), composedAt: z.string(), items: z.array(LabMorningBriefItemSchema), dedupeKeys: z.array(z.string()), text: z.string(), sentAt: z.string().nullable(), sentVia: z.enum(['wizard']).nullable(), sendError: z.string().nullable(), dry: z.boolean() });

/* 06: Ledger (06 2.2, 8.2, 10.2, 12) */
export const LAB_BANDS = ['below', 'normal', 'above', 'breakout'] as const;
export const LabBandSchema = z.enum(LAB_BANDS);
export const LabPredictionOriginSchema = z.enum(['live', 'backtest']);
export const LabPredictionKindSchema = z.enum(['pre_post', 'early', 'pairwise']);
export const LabPredictionStatusSchema = z.enum(['frozen', 'graded', 'ungradable', 'void']);
/** The one list of predictor ids (06 section 3). `external:<tool>` is accepted by the schema, not listed. */
export const LAB_PREDICTOR_IDS = ['creator_median', 'brody', 'sh_6h', 'sh_24h', 'mv_6h', 'mv_24h', 'judge', 'comment_intent'] as const;
export const LabPredictorIdSchema = z.string().regex(/^(creator_median|brody|sh_6h|sh_24h|mv_6h|mv_24h|judge|comment_intent|external:[a-z0-9_]{2,24})$/);
export const LabPredictionSchema = z.object({
  id: z.string(),
  origin: LabPredictionOriginSchema,
  predictor: LabPredictorIdSchema,
  predictorVersion: z.string(),
  kind: LabPredictionKindSchema,
  scriptId: z.string().nullable(),
  scriptVersion: z.number().int().nullable(),
  postId: z.string().nullable(),
  sourceId: z.string().nullable(),
  platform: LabPlatformSchema.nullable(),
  surface: z.string().nullable(),
  refAgeH: z.number().nullable(),
  asOf: z.string(),
  frozenAt: z.string(),
  backtestOrigin: z.string().nullable(),
  band: LabBandSchema.nullable(),
  score: z.number().nullable(),
  ratioPoint: z.number().nullable(), ratioLo: z.number().nullable(), ratioHi: z.number().nullable(),
  viewsPoint: z.number().nullable(), viewsLo: z.number().nullable(), viewsHi: z.number().nullable(),
  pBreakout: z.number().min(0).max(1).nullable(),
  intervalLevel: z.number().nullable(),
  baseline7dViews: z.number().nullable(),
  baselineN: z.number().int().nullable(),
  inputs: z.record(z.unknown()),
  note: z.string(),
  payloadSha256: z.string().length(64),
  late: z.boolean(),
  status: LabPredictionStatusSchema,
  voidReason: z.string().nullable(), voidedAt: z.string().nullable(),
  outcomeViews7d: z.number().nullable(), outcomeRatio7d: z.number().nullable(),
  outcomeBand: LabBandSchema.nullable(), outcomeIsBreakout: z.boolean().nullable(),
  outcomeMethod: z.enum(['interpolated', 'nearest', 'mature', 'bracket']).nullable(), // 06 4.1: AgeValue.how ('bracket' kept for S0 fixture rows)
  hitBand: z.boolean().nullable(), inInterval: z.boolean().nullable(), absLogErr: z.number().nullable(),
  testId: z.string().nullable(),
  pairRight: z.boolean().nullable(),
  gradedAt: z.string().nullable(),
  dry: z.boolean(),
});
export const LabVerdictSchema = z.enum(['beats', 'at_chance', 'worse', 'not_enough']);
export const LabEvalSchema = z.object({
  id: z.number().int().optional(),
  predictor: LabPredictorIdSchema,
  predictorVersion: z.string(),
  scope: z.enum(['backtest', 'live']),
  population: z.enum(['owned', 'all']),
  platform: z.union([LabPlatformSchema, z.literal('all')]),
  windowWeeks: z.number().int(),
  computedDate: z.string(),
  computedAt: z.string(),
  harnessVersion: z.string(),
  origins: z.number().int(),
  nPosts: z.number().int(),
  nCreators: z.number().int(),
  abstained: z.number().int(),
  nPairs: z.number().int(),
  pairwise: z.number().nullable(), pairwiseLo: z.number().nullable(), pairwiseHi: z.number().nullable(),
  spearman: z.number().nullable(), spearmanLo: z.number().nullable(), spearmanHi: z.number().nullable(),
  logMae: z.number().nullable(), logMaeBaseline: z.number().nullable(), maeDeltaLo: z.number().nullable(), maeDeltaHi: z.number().nullable(),
  coverage: z.number().nullable(), coverageLo: z.number().nullable(), coverageHi: z.number().nullable(), coverageN: z.number().int(),
  prAuc: z.number().nullable(), prAucLo: z.number().nullable(), prAucHi: z.number().nullable(), baseRate: z.number().nullable(), positives: z.number().int(),
  bandHits: z.record(z.object({ said: z.number().int(), hit: z.number().int() })),
  verdictForecast: LabVerdictSchema.nullable(), verdictRanking: LabVerdictSchema.nullable(), verdictClassifier: LabVerdictSchema.nullable(),
  dry: z.boolean(),
});
export const LabRetentionSchema = z.object({
  postId: z.string(),
  platform: z.enum(['youtube', 'instagram']),
  source: z.enum(['yt_analytics', 'ig_graph', 'fixture']),
  capturedAt: z.string(),
  ageH: z.number(),
  partial: z.boolean(),
  curve: z.array(z.object({ x: z.number(), awr: z.number(), rrp: z.number().nullable() })).nullable(),
  views: z.number().int().nullable(),
  avgViewDurationS: z.number().nullable(),
  avgViewPct: z.number().nullable(),
  reach: z.number().int().nullable(),
  likes: z.number().int().nullable(),
  comments: z.number().int().nullable(),
  saved: z.number().int().nullable(),
  shares: z.number().int().nullable(),
  totalInteractions: z.number().int().nullable(),
  avgWatchTimeMs: z.number().nullable(),
  totalWatchTimeMs: z.number().nullable(),
  skipRate: z.number().min(0).max(100).nullable(),
  raw: z.record(z.unknown()),
  dry: z.boolean(),
});
export const LabTestKindSchema = z.enum(['trial_reels', 'yt_test_compare', 'self_experiment', 'planned_post']);
export const LabTestStatusSchema = z.enum(['planned', 'running', 'awaiting_result', 'done', 'abandoned']);
export const LabTestResultSchema = z.enum(['winner', 'performed_same', 'inconclusive']);
export const LabTestVariableSchema = z.enum(['hook', 'cover', 'title', 'thumbnail', 'title_thumbnail', 'format', 'length', 'hour', 'other']);
export const LabTestArmSchema = z.object({
  id: z.string(),
  label: z.string().max(80),
  variantText: z.string().max(500),
  hookId: z.string().nullable(),
  featureValue: z.string().nullable(),
  postId: z.string().nullable(),
  metrics: z.object({
    atAgeH: z.number().nullable(),
    reach: z.number().int().nullable(), views: z.number().int().nullable(),
    likes: z.number().int().nullable(), shares: z.number().int().nullable(), saved: z.number().int().nullable(),
    follows: z.number().int().nullable(),
    watchTimeSharePct: z.number().min(0).max(100).nullable(),
    source: z.enum(['instagram_api', 'manual']).nullable(),
  }),
  propensity: z.number().min(0).max(1).nullable(),
});
export const LabTestSchema = z.object({
  id: z.string(),
  kind: LabTestKindSchema,
  title: z.string().min(1).max(120),
  hypothesis: z.string().max(500),
  variable: LabTestVariableSchema,
  featureKey: z.string().nullable(),
  expectedSign: z.union([z.literal(1), z.literal(-1)]).nullable(),
  scriptId: z.string().nullable(),
  platform: LabPlatformSchema,
  status: LabTestStatusSchema,
  arms: z.array(LabTestArmSchema).min(1).max(3),
  judgeAgeH: z.number().nullable(),
  primaryMetric: z.enum(['shares_per_reach', 'likes_per_reach', 'watch_time_share', 'ratio_7d', 'ratio_72h']),
  result: LabTestResultSchema.nullable(),
  winnerArm: z.string().nullable(),
  observedSign: z.union([z.literal(1), z.literal(-1)]).nullable(),
  confirms: z.boolean().nullable(),
  judgeDetail: z.record(z.unknown()),
  notes: z.string().max(1000),
  /** planned_post only: ISO week ('2026-W42'); the lab_tests.plan_week column (06 12). */
  planWeek: z.string().nullable().optional(),
  startedAt: z.string().nullable(), judgedAt: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string(),
  dry: z.boolean(),
});

/* 07: generation, embeddings, comments */
export const VsCandidateSchema = z.object({
  title: z.string().min(3).max(90),
  clusterId: z.string().min(1).nullable().default(null),
  eventId: z.string().min(1).nullable().default(null),
  seedId: z.string().min(1).nullable().default(null),
  angle: z.string().min(2).max(120),
  angleClass: LaunchAngleSchema.catch('other'),
  hookForm: LabHookFormSchema.catch('other'),
  trigger: LabTriggerSchema.catch('other'),
  tension: LabTensionSchema.nullable().default(null),
  formatFamily: z.string().min(1),
  evidence: z.array(z.object({ postId: z.string().min(1), why: z.string().max(200).default('') })).max(6).default([]),
  probability: z.number().min(0).max(1),
}).refine((c) => Boolean(c.clusterId) !== Boolean(c.eventId), 'exactly one of clusterId or eventId');
export const VsReplySchema = z.object({ candidates: z.array(VsCandidateSchema).min(1).max(12) });
export const LabEmbedSubjectSchema = z.enum(['post', 'idea', 'comment', 'query']);
/** lab_embeddings row (07 7.11); `vec` is the Float32 vector (a BLOB in SQLite). */
export const LabEmbeddingSchema = z.object({
  subjectKind: LabEmbedSubjectSchema,
  subjectId: z.string(),
  model: z.string(),
  dim: z.number().int().positive(),
  textHash: z.string(),
  vec: z.instanceof(Float32Array),
  createdAt: z.string(),
});
export const LAB_COMMENT_INTENTS = ['request', 'question', 'praise', 'objection', 'bait', 'other'] as const;
export const LabCommentIntentSchema = z.enum(LAB_COMMENT_INTENTS);
/** lab_comments row (07 7.13.3). Never a handle: authorHash is 32 lowercase hex (HMAC). */
export const LabCommentSchema = z.object({
  id: z.string(),
  postId: z.string(),
  platform: LabPlatformSchema,
  authorHash: z.string().regex(/^[0-9a-f]{32}$/),
  text: z.string(),
  likes: z.number().int().nullable(),
  replies: z.number().int().nullable(),
  isReply: z.boolean(),
  byCreator: z.boolean(),
  creatorHeart: z.boolean().nullable(),
  postedAt: z.string().nullable(),
  capturedAt: z.string(),
  intent: LabCommentIntentSchema,
  intentRule: z.string().nullable(),
  runId: z.string().nullable(),
});

/* 09: prices, schedule config, the Lab's own forecasts */
export const APIFY_TIERS = ['FREE', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'] as const;
export const ApifyTierSchema = z.enum(APIFY_TIERS);
const LabHhMmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** lab_priors `jobcfg:<jobId>` (09.5.3). An absent row means the 08.5.1 default cadence. */
export const JobConfigSchema = z.object({
  v: z.literal(1),
  paused: z.boolean(),
  mode: z.enum(['default', 'interval', 'times']),
  everyMin: z.number().int().min(15).max(10080).optional(),
  times: z.array(LabHhMmSchema).min(1).max(24).optional(),
  weekdays: z.array(z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)])).optional(),
  quiet: z.object({ from: LabHhMmSchema, to: LabHhMmSchema }).nullable().optional(),
  params: z.object({ trackedEveryH: z.number().int().min(6).max(72).optional(), cycleDepth: z.number().int().min(10).max(50).optional() }).optional(),
  updatedAt: z.string(),
  history: z.array(z.object({ at: z.string(), summary: z.string() })).max(10),
});
export const LabForecastKindSchema = z.enum(['run_cost', 'month_cost', 'gate_eta']);
export const LabForecastStatusSchema = z.enum(['open', 'graded', 'late', 'void']);
/** lab_forecasts row (09.6). Not a predictor (06 section 3). */
export const LabForecastSchema = z.object({
  id: z.string(),
  kind: LabForecastKindSchema,
  subject: z.string(),
  frozenAt: z.string(),
  inputs: z.record(z.unknown()),
  predicted: z.number(),
  lo: z.number().nullable(),
  hi: z.number().nullable(),
  expectedItems: z.number().int().nullable(),
  actual: z.number().nullable(),
  actualItems: z.number().int().nullable(),
  status: LabForecastStatusSchema,
  gradedAt: z.string().nullable(),
  dry: z.boolean(),
});

export type LabJobId = z.infer<typeof LabJobIdSchema>;
export type LabJobState = z.infer<typeof LabJobStateSchema>;
export type LabFixtureScenario = z.infer<typeof LabFixtureScenarioSchema>;
export type LaunchAngle = z.infer<typeof LaunchAngleSchema>;
export type LabExoReason = z.infer<typeof LabExoReasonSchema>;
export type LabReadKind = z.infer<typeof LabReadKindSchema>;
export type LabEpoch = z.infer<typeof LabEpochSchema>;
export type LabRuleId = z.infer<typeof LabRuleIdSchema>;
export type LabRuleResult = z.infer<typeof LabRuleResultSchema>;
export type LabIdeaSource = z.infer<typeof LabIdeaSourceSchema>;
export type LabTrajectoryClass = z.infer<typeof LabTrajectoryClassSchema>;
export type LabMetricBasis = z.infer<typeof LabMetricBasisSchema>;
export type LabAgeRead = z.infer<typeof LabAgeReadSchema>;
export type LabMeasureV2 = z.infer<typeof LabMeasureV2Schema>;
export type LabControl = z.infer<typeof LabControlSchema>;
export type LabControlStatus = z.infer<typeof LabControlStatusSchema>;
export type LabRadarSource = z.infer<typeof LabRadarSourceSchema>;
export type LabRadarFamily = z.infer<typeof LabRadarFamilySchema>;
export type LabEventStatus = z.infer<typeof LabEventStatusSchema>;
export type LabNovelty = z.infer<typeof LabNoveltySchema>;
export type LabEventClass = z.infer<typeof LabEventClassSchema>;
export type LabWindowState = z.infer<typeof LabWindowStateSchema>;
export type LabWavePosition = z.infer<typeof LabWavePositionSchema>;
export type LabMorningBriefKind = z.infer<typeof LabMorningBriefKindSchema>;
export type LabEvent = z.infer<typeof LabEventSchema>;
export type LabEventPing = z.infer<typeof LabEventPingSchema>;
export type LabEventCoverage = z.infer<typeof LabEventCoverageSchema>;
export type LabMorningBriefItem = z.infer<typeof LabMorningBriefItemSchema>;
export type LabMorningBrief = z.infer<typeof LabMorningBriefSchema>;
export type LabBand = z.infer<typeof LabBandSchema>;
export type LabPredictorId = string;
export type LabPrediction = z.infer<typeof LabPredictionSchema>;
export type LabVerdict = z.infer<typeof LabVerdictSchema>;
export type LabEval = z.infer<typeof LabEvalSchema>;
export type LabRetention = z.infer<typeof LabRetentionSchema>;
export type LabTestKind = z.infer<typeof LabTestKindSchema>;
export type LabTestStatus = z.infer<typeof LabTestStatusSchema>;
export type LabTestResult = z.infer<typeof LabTestResultSchema>;
export type LabTestArm = z.infer<typeof LabTestArmSchema>;
export type LabTest = z.infer<typeof LabTestSchema>;
export type VsCandidate = z.infer<typeof VsCandidateSchema>;
export type LabEmbedSubject = z.infer<typeof LabEmbedSubjectSchema>;
export type LabEmbedding = Omit<z.infer<typeof LabEmbeddingSchema>, 'vec'> & { vec: Float32Array };
export type LabCommentIntent = z.infer<typeof LabCommentIntentSchema>;
export type LabComment = z.infer<typeof LabCommentSchema>;
export type ApifyTier = z.infer<typeof ApifyTierSchema>;
export type JobConfig = z.infer<typeof JobConfigSchema>;
export type LabForecastKind = z.infer<typeof LabForecastKindSchema>;
export type LabForecastStatus = z.infer<typeof LabForecastStatusSchema>;
export type LabForecast = z.infer<typeof LabForecastSchema>;
/* ── end Content Lab v2 (S0 block) ── */

/* ── FounderOS UI merge, fo/data (docs/projects/founderos-ui/SPEC.md §2.2) ──
 * One zod schema per new table. Rows are camelCase here and snake_case in
 * SQLite (lib/db.ts FO_DDL); the repos in lib/db-ext/* map between them.
 * Nothing in this block is seeded. */

const isoString = z.string().min(1);
const ymdString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must look like 2026-10-13');
const usd = z.number().finite();

// ── Trading (pages/trading.md §2) ──────────────────────────────────────────
/** One account's state at one moment. Every row says which account it is. */
export const TradingAccountSnapshotSchema = z.object({
  capturedAt: isoString,
  accountId: z.string().min(1).max(80),
  accountLabel: z.string().min(1).max(120),
  accountValueUsd: usd,
  buyingPowerUsd: usd,
  cashUsd: usd,
  dayPnlUsd: usd,
  totalPnlUsd: usd,
  source: z.string().min(1).max(80),
});
export const TradingPositionSchema = z.object({
  capturedAt: isoString,
  accountId: z.string().min(1).max(80),
  symbol: z.string().min(1).max(40),
  quantity: z.number().finite(),
  avgCostUsd: usd,
  marketValueUsd: usd,
  unrealizedPnlUsd: usd,
});
export const TradeActionSchema = z.enum(['buy', 'sell']);
export const TradeStatusSchema = z.enum(['filled', 'pending', 'cancelled', 'rejected']);
export const TradeActivitySchema = z.object({
  id: z.string().min(1).max(120),
  at: isoString,
  accountId: z.string().min(1).max(80),
  agent: z.string().min(1).max(120),
  action: TradeActionSchema,
  symbol: z.string().min(1).max(40),
  quantity: z.number().finite(),
  priceUsd: usd,
  rationale: z.string().max(4000),
  status: TradeStatusSchema,
});
/** What the agent looked at on a run and why it did or did not trade. */
export const TradeAnalysisRowSchema = z.object({
  ticker: z.string().min(1).max(40),
  /** null when the agent could not score the name */
  score: z.number().finite().nullable(),
  verdict: z.string().min(1).max(80),
  reason: z.string().max(2000),
});
export const TradeAnalysisSchema = z.object({
  id: z.string().min(1).max(120),
  at: isoString,
  accountId: z.string().min(1).max(80),
  agent: z.string().min(1).max(120),
  examined: z.number().int().nonnegative(),
  signals: z.number().int().nonnegative(),
  notes: z.string().max(8000),
  rows: z.array(TradeAnalysisRowSchema).max(200).default([]),
});
/** A live order at the broker: state, not history (replaced wholesale per push). */
export const TradingOrderSchema = z.object({
  id: z.string().min(1).max(120),
  accountId: z.string().min(1).max(80),
  symbol: z.string().min(1).max(40),
  side: TradeActionSchema,
  type: z.string().min(1).max(40),
  state: z.string().min(1).max(40),
  quantity: z.number().finite(),
  filledQuantity: z.number().finite(),
  /** dollar-based orders carry an amount and no limit; limit orders the reverse */
  dollarAmountUsd: usd.nullable(),
  limitPriceUsd: usd.nullable(),
  placedAgent: z.string().max(120),
  createdAt: isoString,
});
/**
 * The trading agent's limits (one row). Strict: nothing is coerced and
 * nothing defaults except autopilot (off). There are no code defaults shown
 * as if stored (SPEC O4): no row means "No limits saved".
 */
export const TradingLimitsSchema = z.object({
  maxDeployedCapitalUsd: z.number().finite().positive(),
  maxNotionalPerTradeUsd: z.number().finite().positive(),
  maxPositionPctOfSleeve: z.number().finite().positive().max(100),
  maxRiskPctPerTrade: z.number().finite().positive().max(100),
  maxConcurrentPositions: z.number().int().positive(),
  maxTradesPerDay: z.number().int().positive(),
  minSleeveValueUsd: z.number().finite().nonnegative(),
  autopilot: z.boolean().default(false),
});
export const TradingLimitsRowSchema = TradingLimitsSchema.extend({ updatedAt: isoString });
export const TRADING_MAX_POSITIONS_PER_PUSH = 200;
/**
 * POST /api/trading/snapshot body: one account per push. Positions, orders,
 * activity and analysis inherit the snapshot's account (and positions its
 * capture time), so the agent sends them once.
 */
export const TradingPushSchema = z.object({
  snapshot: TradingAccountSnapshotSchema,
  positions: z
    .array(TradingPositionSchema.omit({ capturedAt: true, accountId: true }))
    .max(TRADING_MAX_POSITIONS_PER_PUSH)
    .default([]),
  /** present = replace this account's open orders (an empty array clears them) */
  openOrders: z.array(TradingOrderSchema.omit({ accountId: true })).max(500).optional(),
  activity: z.array(TradeActivitySchema.omit({ accountId: true })).max(500).default([]),
  analysis: TradeAnalysisSchema.omit({ accountId: true }).optional(),
});

// ── Clients (pages/clients.md §2) ──────────────────────────────────────────
/** A client is on the roster only once confirmed here (FO: a payer is not a client). */
export const ClientConfirmationSchema = z.object({
  clientId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  company: z.string().max(200).default(''),
  source: z.enum(['attio', 'manual']),
  retainer: z.boolean().default(false),
  slackChannel: z.string().max(120).nullable().default(null),
  supersetProject: z.string().max(200).nullable().default(null),
  confirmedAt: isoString,
});
export const ClientWorkStatusSchema = z.enum(['draft', 'queued', 'running', 'done', 'failed']);
export const ClientWorkSchema = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1).max(200),
  brief: z.string().trim().min(1).max(8000),
  status: ClientWorkStatusSchema,
  supersetWorkspace: z.string().max(200).nullable().default(null),
  createdAt: isoString,
  finishedAt: isoString.nullable().default(null),
  detail: z.string().max(8000).default(''),
});

// ── Lead magnets (pages/lead-magnets.md §2) ────────────────────────────────
export const LeadMagnetStatusSchema = z.enum(['draft', 'live', 'paused', 'archived']);
export const LeadMagnetDestinationSchema = z.enum(['email', 'booking']);
const httpsUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'must be an https URL');
export const LeadMagnetSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  offer: z.string().max(500).default(''),
  liveUrl: httpsUrl,
  destination: LeadMagnetDestinationSchema,
  campaign: z.string().max(200).default(''),
  status: LeadMagnetStatusSchema.default('draft'),
  wentLiveAt: ymdString.nullable().default(null),
  notes: z.string().max(4000).default(''),
  createdAt: isoString,
  updatedAt: isoString,
});
/** POST body (the content-gen skill posts the same shape). */
export const LeadMagnetInputSchema = LeadMagnetSchema.omit({ id: true, createdAt: true, updatedAt: true });
export const LeadMagnetPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  offer: z.string().max(500).optional(),
  liveUrl: httpsUrl.optional(),
  destination: LeadMagnetDestinationSchema.optional(),
  campaign: z.string().max(200).optional(),
  status: LeadMagnetStatusSchema.optional(),
  wentLiveAt: ymdString.nullable().optional(),
  notes: z.string().max(4000).optional(),
});

// ── Usage (pages/usage.md §2) ──────────────────────────────────────────────
export const UsagePlanSchema = z.enum(['claude', 'codex', 'ollama']);
/** One machine's burn for one plan, model and day. Burn = input + output + cache writes. */
export const UsageReadingSchema = z.object({
  machine: z.string().min(1).max(120),
  plan: UsagePlanSchema,
  day: ymdString,
  model: z.string().min(1).max(120),
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  pushedAt: isoString,
});
/** POST /api/usage/push body. A push replaces that machine's rows for the days it names. */
export const UsagePushSchema = z.object({
  machine: z.string().trim().min(1).max(120),
  readings: z.array(UsageReadingSchema.omit({ machine: true, pushedAt: true })).max(2000),
});

// ── Comms digest (pages/feature-additions.md F3) ───────────────────────────
export const CommsDigestSchema = z.object({
  id: z.string().min(1),
  /** the local day the digest covers */
  date: ymdString,
  /** the built report (lib/comms-digest.ts CommsDigest), stored as JSON */
  body: z.unknown(),
  createdAt: isoString,
});
/** A read mark: the whole digest (entryKey '') or one entry in it. */
export const DigestReadSchema = z.object({
  digestId: z.string().min(1),
  entryKey: z.string().max(400).default(''),
  readAt: isoString,
});

// ── Call recordings (F4) ───────────────────────────────────────────────────
export const CallRecordingSourceSchema = z.enum(['plaud', 'fathom']);
export const CallRecordingSchema = z.object({
  id: z.string().min(1),
  source: CallRecordingSourceSchema,
  externalId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  startedAt: isoString,
  durationS: z.number().int().nonnegative().nullable().default(null),
  participants: z.array(z.string().max(200)).max(100).default([]),
  summary: z.string().max(20000).default(''),
  transcriptUrl: z.string().max(2048).nullable().default(null),
});
/** POST /api/plaud/ingest body. */
export const PlaudIngestSchema = z.object({
  recordings: z.array(CallRecordingSchema.omit({ id: true, source: true })).min(1).max(200),
});

// ── Deliverable decisions (F9) ─────────────────────────────────────────────
export const DeliverableDecisionKindSchema = z.enum(['approved', 'rejected']);
export const DeliverableDecisionSchema = z
  .object({
    runId: z.string().min(1).max(200),
    decision: DeliverableDecisionKindSchema,
    reason: z.string().max(2000).default(''),
    at: isoString,
  })
  .refine((d) => d.decision === 'approved' || d.reason.trim().length > 0, {
    message: 'a rejection needs a reason',
    path: ['reason'],
  });

// ── Cron runs (F10) ────────────────────────────────────────────────────────
export const CronRunSchema = z.object({
  id: z.string().min(1),
  cronId: z.string().min(1),
  agentId: z.string().min(1),
  startedAt: isoString,
  finishedAt: isoString,
  ok: z.boolean(),
  summary: z.string().max(2000),
  /** 'schedule' = fired by the runner, 'manual' = Run now */
  trigger: z.enum(['schedule', 'manual']).default('schedule'),
});

export type TradingAccountSnapshot = z.infer<typeof TradingAccountSnapshotSchema>;
export type TradingPosition = z.infer<typeof TradingPositionSchema>;
export type TradeActivity = z.infer<typeof TradeActivitySchema>;
export type TradeAnalysisRow = z.infer<typeof TradeAnalysisRowSchema>;
export type TradeAnalysis = z.infer<typeof TradeAnalysisSchema>;
export type TradingOrder = z.infer<typeof TradingOrderSchema>;
export type TradingLimits = z.infer<typeof TradingLimitsSchema>;
export type TradingLimitsRow = z.infer<typeof TradingLimitsRowSchema>;
export type TradingPush = z.infer<typeof TradingPushSchema>;
export type ClientConfirmation = z.infer<typeof ClientConfirmationSchema>;
export type ClientConfirmationInput = z.input<typeof ClientConfirmationSchema>;
export type ClientWorkStatus = z.infer<typeof ClientWorkStatusSchema>;
export type ClientWork = z.infer<typeof ClientWorkSchema>;
export type ClientWorkInput = z.input<typeof ClientWorkSchema>;
export type LeadMagnetStatus = z.infer<typeof LeadMagnetStatusSchema>;
export type LeadMagnet = z.infer<typeof LeadMagnetSchema>;
export type LeadMagnetInput = z.input<typeof LeadMagnetInputSchema>;
export type LeadMagnetPatch = z.infer<typeof LeadMagnetPatchSchema>;
export type UsagePlan = z.infer<typeof UsagePlanSchema>;
export type UsageReading = z.infer<typeof UsageReadingSchema>;
export type UsagePush = z.infer<typeof UsagePushSchema>;
export type CommsDigestRow = z.infer<typeof CommsDigestSchema>;
export type DigestRead = z.infer<typeof DigestReadSchema>;
export type CallRecording = z.infer<typeof CallRecordingSchema>;
export type CallRecordingInput = z.input<typeof CallRecordingSchema>;
export type DeliverableDecision = z.infer<typeof DeliverableDecisionSchema>;
export type CronRun = z.infer<typeof CronRunSchema>;
export type CronRunInput = z.input<typeof CronRunSchema>;
/* ── end FounderOS UI merge, fo/data ── */
