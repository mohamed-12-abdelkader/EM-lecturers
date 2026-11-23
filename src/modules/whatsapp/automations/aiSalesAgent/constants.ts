export const AI_SALES_AGENT_KEY = 'ai_sales_agent';

export const DEFAULT_ENABLED_TOOLS = [
  'search_knowledge',
  'list_packages',
  'send_demo_link',
  'send_signup_link',
  'update_lead',
  'set_lead_stage',
  'add_note',
  'create_followup',
  'cancel_followup',
  'stop_followups',
  'mark_won',
  'escalate_human',
] as const;

export const DEFAULT_STAGES = [
  { key: 'new', label: 'New Lead' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'interested', label: 'Interested' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'demo_requested', label: 'Demo Requested' },
  { key: 'demo_completed', label: 'Demo Completed' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
  { key: 'not_interested', label: 'Not Interested' },
] as const;

export const DEFAULT_FOLLOWUP_SETTINGS = {
  enabled: true,
  max_followups: 3,
  min_hours_between: 24,
  quiet_hours_start: 22,
  quiet_hours_end: 9,
  workdays: [0, 1, 2, 3, 4],
  stop_on_won: true,
  stop_on_not_interested: true,
  stop_on_opt_out: true,
  instructions: '',
};
